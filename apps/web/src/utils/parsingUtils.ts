// utils/parsingUtils.ts
/**
 * Safely parses a value into a floating-point number.
 * Handles both Brazilian currency format (e.g., "R$ 1.234,56") and standard/XML format (e.g., "1234.56").
 * Returns 0 for null, undefined, NaN, or non-numeric strings.
 * @param value The value to parse.
 * @returns The parsed number, or 0 if parsing fails.
 */
export const parseSafeFloat = (value: any): number => {
    if (value === null || value === undefined) return 0;
    if (typeof value === 'number') return isNaN(value) ? 0 : value;
    if (typeof value !== 'string' || value.trim() === '') return 0;

    let s = value.trim();

    // If a comma exists, we assume it's a decimal separator (pt-BR style).
    // In this case, dots are thousands separators and should be removed.
    if (s.includes(',')) {
        s = s.replace(/[^\d,-]/g, '').replace(/\./g, '').replace(',', '.');
    } else {
        // If no comma exists, we assume it's a standard format where dot is the decimal separator.
        // We only remove characters that are not digits, a dot, or a minus sign.
        s = s.replace(/[^\d.-]/g, '');
    }

    const num = parseFloat(s);
    return isNaN(num) ? 0 : num;
};
