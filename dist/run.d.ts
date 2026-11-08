import { type Options } from './audit.js';
import { type Report } from './model.js';
export type Format = 'json' | 'markdown' | 'html' | 'both';
export declare function runAudit(url: string, compareUrl: string | undefined, options: Options): Promise<Report>;
export declare function writeReports(report: Report, output: string, format: Format): Promise<void>;
