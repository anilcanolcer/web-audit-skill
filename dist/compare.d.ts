import type { Comparison, Report } from './model.js';
/** Score difference is comparison minus primary. Findings are compared by check ID, not page URL. */
export declare function compareReports(primary: Report, other: Report): Comparison;
