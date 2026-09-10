export function cn(...inputs) {
  return inputs
    .flatMap((input) => {
      if (!input) return [];
      if (Array.isArray(input)) return input;
      if (typeof input === 'object') {
        return Object.entries(input)
          .filter(([, enabled]) => Boolean(enabled))
          .map(([className]) => className);
      }
      return [input];
    })
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}
