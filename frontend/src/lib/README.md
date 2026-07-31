# BOM Normalizer Algorithm Files

This folder holds reusable BOM Normalizer logic so new parsing cases can be added without editing the full page component.

- `bomNormalizerAlgorithmRegistry.js`
  - UI-visible parser scenarios.
  - alternate layouts, quantity modes, delimiter options.
  - cleanup rules.
  - fallback manufacturer phrases.
  - MPN noise and connector words.

- `bomNormalizerAlgorithms.js`
  - reusable row transformations after normalization.
  - item-code generation.
  - tag-column generation.
  - normalized export column handling.

When adding a new BOM format, add the rule/config here first, then wire only the needed UI or parser branch in `pages/BomNormalizer.js`.
