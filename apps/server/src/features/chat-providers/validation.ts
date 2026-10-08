export function hasControlCharacters(value: string): boolean {
  return [...value].some(
    (char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127,
  );
}
