/**
 * TS-10, PL-13 · text that looks like a number of a bank card: 13–19 digits in a row or separated by spaces and hyphens,
 * and the digits pass the Luhn check. Such answers are refused on the client and on the server and are never stored.
 */
export const CARD_WARNING = 'Похоже на номер карты. Никогда не вводите данные карт в опросах';

function luhn(digits: string): boolean {
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits.charCodeAt(i) - 48;
    if (double) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    double = !double;
  }
  return sum % 10 === 0;
}

export function looksLikeCardNumber(text: string): boolean {
  // Runs of digits that may be separated by single spaces or hyphens; inside a run, every stretch of whole groups of 13–19 digits is a candidate
  // (so «карта 4111 1111 1111 1111 12» is caught), but never a piece of a group.
  for (const run of text.match(/\d(?:[ -]?\d)*/g) ?? []) {
    const groups = run.split(/[ -]/);
    for (let from = 0; from < groups.length; from++) {
      let digits = '';
      for (let to = from; to < groups.length; to++) {
        digits += groups[to];
        if (digits.length > 19) break;
        if (digits.length >= 13 && luhn(digits)) return true;
      }
    }
  }
  return false;
}
