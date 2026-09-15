"""Server-side calls to the FactWise 4.0 API, for the 4.0 export popup.

The popup cannot talk to 4.0 from the browser: the 4.0 backend registers no
CORS middleware, so a cross-origin request from the mapper's origin is refused
at the preflight before it is ever sent. FactWise's own portal has the same
constraint and solves it the same way — it calls a same-origin route that
forwards server-side. These views are the mapper's equivalent.

Only the 4.0 export flow uses them. Nothing else in the mapper changes: the
existing FactWise integration keeps talking to the 3.0 API exactly as it did.
"""

import io
import logging

import requests
from rest_framework import status
from rest_framework.decorators import api_view, parser_classes
from rest_framework.parsers import FormParser, MultiPartParser
from rest_framework.response import Response

logger = logging.getLogger(__name__)

# 4.0 validates a sheet per import type. The combined item+BOM sheet goes to
# `item` — that importer reads the BOM columns too, which is where a missing
# BOM code is reported. `bom` is the BOM-only sheet, `bom_revision` a revision.
VALID_IMPORT_TYPES = {'item', 'bom', 'bom_revision'}

# Long enough for a large sheet to be parsed and every row checked, short
# enough that a hung backend surfaces as an error rather than a spinner.
VALIDATE_TIMEOUT_SECONDS = 180

# The 4.0 calls the export flow is allowed to make, named so the browser never
# supplies a URL. Anything not on this list is refused: the caller's job is a
# fixed sequence (check the sheet, pick a project, import, attach), not general
# access to FactWise.
#
# `commit` is deliberately absent — it takes the sheet itself and goes through
# factwise40_validate, which handles multipart.
CALLS = {
    # Projects are created against an ENTITY, not the enterprise. The launch URL
    # sends the enterprise id under `entity_id` as well, for 3.0's benefit, so
    # the real entity has to be read from FactWise rather than assumed.
    'entities': ('GET', '/enterprises/{enterprise_id}/entities'),
    'projects_list': ('GET', '/enterprises/{enterprise_id}/projects'),
    'project_create': ('POST', '/enterprises/{enterprise_id}/projects'),
    # Commit reports counts, not ids, so the BOM it just created has to be found
    # by the code the sheet carried.
    'boms_list': ('GET', '/enterprises/{enterprise_id}/boms'),
    'project_add_bom': ('POST', '/enterprises/{enterprise_id}/projects/{project_id}/boms'),
}


def _clean_api_url(value):
    """The 4.0 base URL, or '' when it is not one we are willing to call.

    The value reaches us from the browser, which got it from FactWise's launch
    URL. Restricting it to http(s) keeps a tampered parameter from turning this
    view into a request forwarder for arbitrary schemes.
    """
    url = str(value or '').strip().rstrip('/')
    if not url.startswith('http://') and not url.startswith('https://'):
        return ''
    return url


def _container_fallback_url(url):
    """The same URL as seen from inside a container, or '' when unchanged.

    Locally the mapper's backend runs in Docker while FactWise runs on the host,
    so the `localhost` the browser was handed on the launch URL is the container
    itself here and the connection is refused. Deployed, both are real hosts and
    this never applies — which is why it is a fallback after a failure rather
    than a rewrite of every request.
    """
    for host in ('//localhost:', '//127.0.0.1:'):
        if host in url:
            return url.replace(host, '//host.docker.internal:', 1)
    return ''


def _sheet_bom_codes(raw):
    """The distinct BOM codes a combined sheet carries, in the order they appear.

    Commit reports counts, never ids, so the BOM it just created cannot be named
    from its response. The sheet itself is the only place the link survives: the
    `BOM code` column the export wrote is what FactWise stored as `bom_code`, so
    that is what the created BOM is found by afterwards.
    """
    import openpyxl

    try:
        workbook = openpyxl.load_workbook(io.BytesIO(raw), read_only=True, data_only=True)
    except Exception as exc:  # pragma: no cover - a sheet that parsed for FactWise
        logger.warning('Combined sheet could not be re-read for BOM codes: %s', exc)
        return []
    try:
        sheet = workbook.worksheets[0]
        rows = sheet.iter_rows(values_only=True)
        headers = next(rows, None) or ()
        position = next(
            (index for index, header in enumerate(headers)
             if str(header or '').strip().casefold() == 'bom code'),
            -1,
        )
        if position < 0:
            return []
        codes = []
        for row in rows:
            if position >= len(row):
                continue
            code = str(row[position] or '').strip()
            if code and code not in codes:
                codes.append(code)
        return codes
    finally:
        workbook.close()


def _credentials(data):
    """(api_url, enterprise_id, token, error_response)."""
    api_url = _clean_api_url(data.get('api_url'))
    enterprise_id = str(data.get('enterprise_id') or '').strip()
    token = str(data.get('token') or '').strip()
    missing = None
    if not api_url:
        missing = 'No FactWise API URL — open the mapper from FactWise.'
    elif not enterprise_id:
        missing = 'No enterprise — open the mapper from FactWise.'
    elif not token:
        missing = 'No FactWise session — open the mapper from FactWise.'
    if missing:
        return '', '', '', Response({'success': False, 'error': missing},
                                    status=status.HTTP_400_BAD_REQUEST)
    return api_url, enterprise_id, token, None


def _send(method, api_url, path, headers, **kwargs):
    """Call 4.0, retrying once through the container's view of the host.

    Returns (response, error_response).
    """
    try:
        return requests.request(method, api_url + path, headers=headers,
                                timeout=VALIDATE_TIMEOUT_SECONDS, **kwargs), None
    except requests.RequestException as exc:
        fallback = _container_fallback_url(api_url)
        if not fallback:
            logger.warning('FactWise 4.0 %s %s unreachable: %s', method, api_url + path, exc)
            return None, Response({'success': False, 'error': 'Could not reach FactWise.'},
                                  status=status.HTTP_502_BAD_GATEWAY)
        logger.info('FactWise 4.0: %s unreachable from here, retrying via %s', api_url, fallback)
        try:
            return requests.request(method, fallback + path, headers=headers,
                                    timeout=VALIDATE_TIMEOUT_SECONDS, **kwargs), None
        except requests.RequestException as retry_exc:
            logger.warning('FactWise 4.0 %s %s unreachable: %s', method, fallback + path, retry_exc)
            return None, Response({'success': False, 'error': 'Could not reach FactWise.'},
                                  status=status.HTTP_502_BAD_GATEWAY)


def _unwrap(response):
    """(payload, error_response) — 4.0's own message survives a failure."""
    try:
        payload = response.json()
    except ValueError:
        logger.warning('FactWise 4.0 returned non-JSON (%s): %s',
                       response.status_code, response.text[:400])
        return None, Response(
            {'success': False,
             'error': 'FactWise returned an unexpected response (%s).' % response.status_code},
            status=status.HTTP_502_BAD_GATEWAY)
    if response.status_code >= 400:
        detail = payload.get('detail') if isinstance(payload, dict) else payload
        logger.info('FactWise 4.0 refused the request (%s): %s', response.status_code, str(detail)[:300])
        return None, Response({'success': False, 'error': detail, 'status': response.status_code},
                              status=status.HTTP_400_BAD_REQUEST)
    return payload, None


@api_view(['POST'])
@parser_classes([MultiPartParser, FormParser])
def factwise40_validate(request):
    """Run a sheet through FactWise 4.0's validator, or commit it.

    `action` picks which: `validate` reports what is wrong, `commit` creates the
    items and the BOM. They are one view because they take the same multipart
    upload and differ only in the last path segment.

    The sheet is uploaded by the caller rather than rebuilt here, so what gets
    validated is byte-for-byte the file the user would download — there is no
    second code path that could drift from the export.

    Returns 4.0's own payload untouched (`ok`, `row_count`, `error_count`,
    `errors` for a validate; the commit outcome otherwise). The mapper shows
    exactly what FactWise reports and adds no findings of its own.
    """
    action = str(request.data.get('action') or 'validate').strip().lower()
    if action not in ('validate', 'commit'):
        return Response({'success': False, 'error': 'Unknown action "%s"' % action},
                        status=status.HTTP_400_BAD_REQUEST)

    upload = request.FILES.get('file')
    if upload is None:
        return Response({'success': False, 'error': 'No sheet was supplied'},
                        status=status.HTTP_400_BAD_REQUEST)

    api_url, enterprise_id, token, error = _credentials(request.data)
    if error is not None:
        return error

    import_type = str(request.data.get('import_type') or 'item').strip().lower()
    if import_type not in VALID_IMPORT_TYPES:
        return Response({'success': False, 'error': 'Unknown import type "%s"' % import_type},
                        status=status.HTTP_400_BAD_REQUEST)

    # Read once: the upload is a stream, and the retry inside _send may need to
    # send the very same bytes a second time.
    sheet = (
        upload.name or 'sheet.xlsx',
        upload.read(),
        upload.content_type or
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    )
    path = '/enterprises/%s/bulk-imports/%s/%s' % (enterprise_id, import_type, action)
    headers = {'Authorization': 'Bearer %s' % token}

    response, error = _send('POST', api_url, path, headers, files={'file': sheet})
    if error is not None:
        return error
    payload, error = _unwrap(response)
    if error is not None:
        return error

    if action == 'commit':
        logger.info('FactWise 4.0 commit: created=%s updated=%s',
                    payload.get('created'), payload.get('updated'))
        # Returned alongside the outcome because the caller has to find the BOM
        # that was just created, and commit does not name it.
        return Response({'success': True, 'result': payload,
                         'bom_codes': _sheet_bom_codes(sheet[1])})

    logger.info('FactWise 4.0 validate: rows=%s errors=%s',
                payload.get('row_count'), payload.get('error_count'))
    return Response({'success': True, 'result': payload})


@api_view(['POST'])
def factwise40_call(request):
    """Make one of the allowed FactWise 4.0 calls on the caller's behalf.

    Same reason as the validate view: 4.0 sends no CORS headers, so none of this
    can happen in the browser. The operation is named, never a URL, so the
    caller cannot reach anything outside the export sequence.
    """
    operation = str(request.data.get('op') or '').strip()
    if operation not in CALLS:
        return Response({'success': False, 'error': 'Unknown operation "%s"' % operation},
                        status=status.HTTP_400_BAD_REQUEST)

    api_url, enterprise_id, token, error = _credentials(request.data)
    if error is not None:
        return error

    method, template = CALLS[operation]
    project_id = str(request.data.get('project_id') or '').strip()
    if '{project_id}' in template and not project_id:
        return Response({'success': False, 'error': 'Missing project for "%s"' % operation},
                        status=status.HTTP_400_BAD_REQUEST)
    path = template.format(enterprise_id=enterprise_id, project_id=project_id)

    headers = {'Authorization': 'Bearer %s' % token}
    kwargs = {}
    if method == 'POST':
        kwargs['json'] = request.data.get('body') or {}
    else:
        kwargs['params'] = request.data.get('params') or {}

    response, error = _send(method, api_url, path, headers, **kwargs)
    if error is not None:
        return error
    payload, error = _unwrap(response)
    if error is not None:
        return error
    return Response({'success': True, 'result': payload})
