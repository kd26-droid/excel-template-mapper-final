import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Autocomplete,
  Box,
  Button,
  Checkbox,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  FormControlLabel,
  Grid,
  IconButton,
  Menu,
  MenuItem,
  Radio,
  RadioGroup,
  TextField,
  Typography,
} from '@mui/material';
import KeyboardArrowDownIcon from '@mui/icons-material/KeyboardArrowDown';
import KeyboardArrowUpIcon from '@mui/icons-material/KeyboardArrowUp';
import CloseIcon from '@mui/icons-material/Close';
import { fetchSimilarTags, listAllItemTags } from '../services/factwiseApi';

// This component is a direct port of FactWise's admin
// `NewTagsConfirmationPopup.tsx` (+ its `SinlgeTagRow.tsx` and inline
// `SelectAllRow` / `HeaderRow` helpers). Layout, state machine and payload
// shape all match 1:1 so the popup behaves identically to what users see on
// the Item Directory bulk-import page.
//
//   Layout (top → bottom, matches screenshot 5.03.48 PM.png):
//     Title bar         : "New tags detected" + Re-Upload icon
//     Description       : "The import contains tags that do not exist ..."
//     [Divider]
//     SelectAllRow      : right-aligned "Apply Defaults" menu
//                         ├─ Create new tags for all
//                         └─ Mark as synonym for all
//     [Divider]
//     HeaderRow         : ☐  New tag name │ Suggested existing tags │ Actions
//     [Divider]
//     SingleTagRow list : per new tag →
//                         ☐  <tag>      <chip chip chip>   ○ Create as new tag
//                                                          ○ Mark as synonym of existing tag
//                                                          (Autocomplete when SYNONYM)
//     [Divider]
//     Save              : disabled when payload is empty
//
//   Output payload shape (what FW's reUploadData expects, unchanged):
//     { [tagName]: { synonym: string } }
//   synonym === '' means "create as new"; anything else means "mark as
//   synonym of that existing tag".
export default function FactwiseNewTagsPopup({
  open,
  onClose,
  tags,
  onConfirm,
  submitting = false,
}) {
  const isProcessingRef = useRef(false);
  const [loader, setLoader] = useState(false);
  const [similarTags, setSimilarTags] = useState({});
  const [selectAll, setSelectAll] = useState(true);
  // Payload keyed by tag name. A tag that ISN'T in payload keys is treated
  // as "excluded from this reupload" (mirrors FW's updateSelectedTags which
  // deletes the key on uncheck).
  const [payload, setPayload] = useState(() => {
    const initial = {};
    tags.forEach((t) => { initial[t] = { synonym: '' }; });
    return initial;
  });

  // Reset internal state every time the popup opens so a subsequent retry
  // with a fresh tag list doesn't inherit stale selections.
  useEffect(() => {
    if (!open) return;
    isProcessingRef.current = false;
    setSimilarTags({});
    setSelectAll(true);
    const seed = {};
    tags.forEach((t) => { seed[t] = { synonym: '' }; });
    setPayload(seed);
  }, [open, tags]);

  // Fetch similar existing tags for every incoming tag, then auto-preselect
  // the first suggestion where available (matches FW's default behaviour in
  // `NewTagsConfirmationPopup.useEffect(getNewTagSynonyms)`).
  useEffect(() => {
    if (!open) return;
    if (isProcessingRef.current) return;
    if (Object.keys(similarTags).length > 0) return;
    if (!tags?.length) return;
    setLoader(true);
    isProcessingRef.current = true;
    fetchSimilarTags(tags)
      .then((res) => {
        const resp = res?.similar || {};
        setSimilarTags(resp);
        setPayload((prev) => {
          const next = { ...prev };
          tags.forEach((tag) => {
            const current = resp?.[tag];
            if (Array.isArray(current) && current.length > 0) {
              next[tag] = { synonym: current[0].name };
            }
          });
          return next;
        });
      })
      .finally(() => {
        setLoader(false);
        isProcessingRef.current = false;
      });
  }, [open, tags, similarTags]);

  // Toggle a tag in/out of the payload (checkbox on the leftmost column).
  const updateSelectedTags = useCallback((tag, wasSelected) => {
    setPayload((prev) => {
      const next = { ...prev };
      if (wasSelected) {
        delete next[tag];
      } else {
        next[tag] = { synonym: '' };
      }
      setSelectAll(Object.keys(next).length === tags.length);
      return next;
    });
  }, [tags]);

  // Change the creation-mode for a single tag (Create as new OR mark as
  // synonym of value).
  const updateCreationType = useCallback((tag, action) => {
    setPayload((prev) => {
      const next = { ...prev };
      if (!next[tag]) next[tag] = { synonym: '' };
      if (action.type === 'NEW') {
        next[tag] = { synonym: '' };
      } else if (action.type === 'SYNONYM') {
        next[tag] = { synonym: action.value || '' };
      }
      return next;
    });
  }, []);

  const handleSelectAll = useCallback(() => {
    if (selectAll) {
      setPayload({});
    } else {
      setPayload(() => {
        const data = {};
        tags.forEach((tag) => {
          const list = similarTags[tag] || [];
          data[tag] = { synonym: list.length > 0 ? list[0].name : '' };
        });
        return data;
      });
    }
    setSelectAll((prev) => !prev);
  }, [selectAll, similarTags, tags]);

  // Bulk "Apply defaults" menu handlers. CREATE is a straight port of FW's
  // handler; MARK is the same UNLESS a tag has no similar-tag suggestion —
  // in which case we fall back to the FIRST existing tag in FactWise's full
  // list (fetched via /dashboard/ tags view) so the radio actually flips
  // to SYNONYM and shows a valid default. Without the fallback, the empty
  // synonym reads back as "Create as new" and the button looks broken.
  const [bulkFetching, setBulkFetching] = useState(false);
  const handleBulkUpdate = useCallback(async (type) => {
    if (type === 'CREATE') {
      setPayload((prev) => {
        const next = { ...prev };
        Object.keys(next).forEach((k) => { next[k] = { synonym: '' }; });
        return next;
      });
      return;
    }
    if (type === 'MARK') {
      // First pass: whatever similar suggestions we already have.
      let firstFallback = '';
      const needsFallback = tags.some((t) => !(similarTags[t] || []).length);
      if (needsFallback) {
        setBulkFetching(true);
        try {
          const res = await listAllItemTags({ pageNumber: 1, itemsPerPage: 5 });
          firstFallback = res?.tags?.[0]?.name || '';
        } finally {
          setBulkFetching(false);
        }
      }
      setPayload((prev) => {
        const next = { ...prev };
        Object.keys(next).forEach((k) => {
          const list = similarTags[k] || [];
          next[k] = {
            synonym: list.length > 0 ? list[0].name : firstFallback,
          };
        });
        return next;
      });
    }
  }, [similarTags, tags]);

  const canSave = useMemo(() => Object.keys(payload).length > 0, [payload]);

  return (
    <Dialog
      open={open}
      onClose={submitting ? undefined : onClose}
      maxWidth="md"
      fullWidth
      PaperProps={{ sx: { borderRadius: '14px', width: '60%', maxWidth: '900px' } }}
    >
      <DialogTitle
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          pr: 2,
        }}
      >
        <Typography variant="h6" sx={{ fontWeight: 650 }}>
          New tags detected
        </Typography>
        <IconButton
          onClick={onClose}
          disabled={submitting}
          title="Close and edit inline instead"
          size="small"
        >
          <CloseIcon />
        </IconButton>
      </DialogTitle>

      <DialogContent dividers>
        <Typography sx={{ pb: 1, whiteSpace: 'normal', wordWrap: 'break-word' }}>
          The import contains tags that do not exist in the system. Review
          how these tags should be created or mapped before continuing.
        </Typography>
        <Typography variant="caption" sx={{ pb: 2, display: 'block', color: 'text.secondary' }}>
          Prefer to edit the tag inline in the red cell instead? Click the ×
          in the top right to close this dialog and edit the highlighted
          cells directly.
        </Typography>

        <Divider />

        <SelectAllRow
          handleBulkUpdate={handleBulkUpdate}
          disabled={loader || submitting || bulkFetching}
          fetching={bulkFetching}
        />

        <Divider />

        <HeaderRow selectAll={selectAll} handleSelectAll={handleSelectAll} disabled={loader || submitting} />

        <Divider />

        {loader ? (
          <Box
            sx={{
              width: '100%',
              display: 'flex',
              justifyContent: 'center',
              alignItems: 'center',
              gap: 2,
              py: 5,
            }}
          >
            <Typography color="text.secondary" sx={{ px: 2 }}>
              {`Populating ${tags.length} new tag${tags.length === 1 ? '' : 's'}`}
            </Typography>
            <CircularProgress size={18} />
          </Box>
        ) : (
          <Box sx={{ maxHeight: 350, overflow: 'auto' }}>
            {tags.map((tag, i) => (
              <React.Fragment key={tag}>
                <SingleTagRow
                  tag={tag}
                  updateSelectedTags={updateSelectedTags}
                  selected={Boolean(payload[tag])}
                  similarTags={similarTags[tag] || []}
                  creationType={
                    payload[tag]
                      ? payload[tag].synonym === ''
                        ? 'NEW'
                        : 'SYNONYM'
                      : 'BLANK'
                  }
                  currentValue={payload[tag]?.synonym || ''}
                  updateCreationType={updateCreationType}
                  disabled={submitting}
                />
                {i !== tags.length - 1 && <Divider />}
              </React.Fragment>
            ))}
          </Box>
        )}

        <Divider />
      </DialogContent>

      <DialogActions sx={{ m: '12px 24px 24px 24px' }} onClick={(e) => e.stopPropagation()}>
        <Button onClick={onClose} disabled={submitting}>
          Edit inline instead
        </Button>
        <Button
          variant="contained"
          color="primary"
          onClick={() => onConfirm(payload)}
          disabled={!canSave || submitting}
          startIcon={submitting ? <CircularProgress size={14} /> : null}
        >
          {submitting ? 'Saving…' : 'Save'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

// SelectAllRow — mirrors the "Apply defaults" menu button on the right.
function SelectAllRow({ handleBulkUpdate, disabled, fetching }) {
  const [anchorEl, setAnchorEl] = useState(null);
  const handleClick = (e) => setAnchorEl(e.currentTarget);
  const handleClose = () => setAnchorEl(null);
  const open = Boolean(anchorEl);
  return (
    <Grid
      container
      alignItems="center"
      justifyContent="space-between"
      sx={{ py: 2 }}
    >
      <Box />
      <Box>
        <Button
          variant="contained"
          color="primary"
          onClick={handleClick}
          disabled={disabled}
          startIcon={fetching ? <CircularProgress size={14} color="inherit" /> : null}
          endIcon={open ? <KeyboardArrowUpIcon /> : <KeyboardArrowDownIcon />}
        >
          {fetching ? 'Loading tags…' : 'Apply Defaults'}
        </Button>
        <Menu open={open} anchorEl={anchorEl} onClose={handleClose}>
          <MenuItem
            onClick={() => {
              handleBulkUpdate('CREATE');
              handleClose();
            }}
          >
            Create new tags for all
          </MenuItem>
          <MenuItem
            onClick={() => {
              handleBulkUpdate('MARK');
              handleClose();
            }}
          >
            Mark as synonym for all
          </MenuItem>
        </Menu>
      </Box>
    </Grid>
  );
}

// HeaderRow — column labels + select-all checkbox.
function HeaderRow({ selectAll, handleSelectAll, disabled }) {
  return (
    <Grid container spacing={1} alignItems="center" sx={{ py: 2 }}>
      <Grid item xs={1}>
        <Checkbox
          checked={selectAll}
          onChange={handleSelectAll}
          disabled={disabled}
          size="small"
          sx={{ '&.MuiCheckbox-root': { padding: '0px 9px' } }}
        />
      </Grid>
      <Grid item xs={2.5}>
        <Typography sx={{ fontWeight: 600 }}>New tag name</Typography>
      </Grid>
      <Grid item xs={4}>
        <Typography sx={{ fontWeight: 600 }}>Suggested existing tags</Typography>
      </Grid>
      <Grid item xs={4}>
        <Typography sx={{ fontWeight: 600 }}>Actions</Typography>
      </Grid>
    </Grid>
  );
}

// SingleTagRow — one row per new tag. Layout matches FW's SinlgeTagRow.tsx:
//   [Checkbox] [tag]         [chips of similar tags]   [Radio group + optional Autocomplete]
//
// The synonym Autocomplete is search-driven (debounced) against FactWise's
// full tag list — matches FW's useListTagsViaDashboardMutation pattern so
// users can pick ANY existing tag, not just those flagged as similar. The
// "Mark as synonym of existing tag" radio is ALWAYS enabled (even with no
// similar suggestions) because the user might know a semantically related
// tag that the similar-tags API missed.
const LOAD_MORE_SENTINEL = '___LOAD_MORE___';

function SingleTagRow({
  tag,
  updateSelectedTags,
  selected,
  similarTags,
  creationType,
  currentValue,
  updateCreationType,
  disabled,
}) {
  const [searchText, setSearchText] = useState('');
  const [pageNo, setPageNo] = useState(1);
  const [listedTags, setListedTags] = useState([]);
  const [hasNext, setHasNext] = useState(false);
  const [fetching, setFetching] = useState(false);
  const debounceRef = useRef(null);
  const seededRef = useRef(false);

  const runFetch = useCallback(async (text, page) => {
    setFetching(true);
    try {
      const res = await listAllItemTags({
        searchText: text,
        pageNumber: page,
        itemsPerPage: 10,
      });
      const newRows = Array.isArray(res.tags) ? res.tags : [];
      setHasNext(Boolean(res.hasNext));
      setListedTags((prev) => {
        // Page 1 replaces; subsequent pages append with dedup by tag_id/name.
        const base = page === 1 ? [] : prev;
        const merged = [...base];
        newRows.forEach((r) => {
          const key = r.tag_id || r.name;
          if (!merged.some((x) => (x.tag_id || x.name) === key)) merged.push(r);
        });
        return merged;
      });
    } finally {
      setFetching(false);
    }
  }, []);

  const handleInputChange = useCallback((_, value, reason) => {
    if (reason === 'reset') return;
    setSearchText(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setPageNo(1);
      runFetch(value || '', 1);
    }, 400);
  }, [runFetch]);

  const handleOpen = useCallback(() => {
    if (!seededRef.current) {
      seededRef.current = true;
      runFetch('', 1);
    }
  }, [runFetch]);

  useEffect(() => () => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
  }, []);

  // Merge the fetched tags with the similarTags suggestions so the user
  // always sees the suggested ones at the top even before typing.
  const options = useMemo(() => {
    const seen = new Set();
    const merged = [];
    const push = (name) => {
      if (!name || seen.has(name)) return;
      seen.add(name);
      merged.push(name);
    };
    similarTags.forEach((t) => push(t.name));
    listedTags.forEach((t) => push(t.name));
    if (hasNext) merged.push(LOAD_MORE_SENTINEL);
    return merged;
  }, [similarTags, listedTags, hasNext]);

  const handleRadioChange = (newType) => {
    if (newType === 'NEW') {
      updateCreationType(tag, { type: 'NEW' });
      return;
    }
    // On flipping to SYNONYM: default to first suggestion, else first fetched
    // tag, else keep whatever the user already typed. Even '' is valid — the
    // Autocomplete will let them search interactively.
    const firstName =
      similarTags[0]?.name
      || listedTags[0]?.name
      || currentValue
      || '';
    updateCreationType(tag, { type: 'SYNONYM', value: firstName });
    // Also kick off the initial fetch so the dropdown is populated when the
    // user opens it.
    if (!seededRef.current) {
      seededRef.current = true;
      runFetch('', 1);
    }
  };
  return (
    <Grid container spacing={1} alignItems="flex-start" sx={{ py: 2 }}>
      <Grid item xs={1}>
        <Checkbox
          checked={selected}
          onChange={() => updateSelectedTags(tag, selected)}
          disabled={disabled}
          size="small"
          sx={{ '&.MuiCheckbox-root': { padding: '0px 9px' } }}
        />
      </Grid>
      <Grid item xs={2.5}>
        <Typography sx={{ wordBreak: 'break-word' }}>{tag}</Typography>
      </Grid>
      <Grid item xs={4}>
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
          {similarTags.length === 0 ? (
            <Typography variant="caption" color="text.disabled">
              No suggestions
            </Typography>
          ) : (
            similarTags.map((t) => <Chip key={t.tag_id || t.name} label={t.name} size="small" />)
          )}
        </Box>
      </Grid>
      <Grid item xs={4}>
        <RadioGroup
          value={creationType}
          onChange={(e) => handleRadioChange(e.target.value)}
        >
          <FormControlLabel
            value="NEW"
            control={<Radio size="small" />}
            disabled={!selected || disabled}
            label={<Typography variant="body2">Create as new tag</Typography>}
          />
          <FormControlLabel
            value="SYNONYM"
            control={<Radio size="small" />}
            disabled={!selected || disabled}
            label={
              <Typography variant="body2">
                Mark as synonym of existing tag
              </Typography>
            }
          />
        </RadioGroup>
        {creationType === 'SYNONYM' && (
          <Autocomplete
            size="small"
            options={options}
            value={currentValue || null}
            loading={fetching}
            onOpen={handleOpen}
            onInputChange={handleInputChange}
            onChange={(_, v) => {
              if (!v || v === LOAD_MORE_SENTINEL) return;
              updateCreationType(tag, { type: 'SYNONYM', value: v });
            }}
            filterOptions={(opts) => opts} // server-side search — don't client-filter
            renderOption={(props, option) => {
              if (option === LOAD_MORE_SENTINEL) {
                return (
                  <li
                    {...props}
                    key="load-more"
                    onClick={(e) => {
                      e.stopPropagation();
                      e.preventDefault();
                      const next = pageNo + 1;
                      setPageNo(next);
                      runFetch(searchText, next);
                    }}
                    style={{ color: '#1976d2', fontWeight: 500 }}
                  >
                    Show more results…
                  </li>
                );
              }
              return (
                <li {...props} key={option}>
                  {option}
                </li>
              );
            }}
            disabled={disabled}
            disableClearable
            sx={{ mt: 0.5 }}
            renderInput={(params) => (
              <TextField
                {...params}
                size="small"
                placeholder="Search existing tags…"
                InputProps={{
                  ...params.InputProps,
                  endAdornment: (
                    <>
                      {fetching ? <CircularProgress size={14} /> : null}
                      {params.InputProps.endAdornment}
                    </>
                  ),
                }}
              />
            )}
          />
        )}
      </Grid>
    </Grid>
  );
}
