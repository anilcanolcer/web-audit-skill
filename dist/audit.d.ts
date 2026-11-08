import { type Report } from './model.js';
export interface Options {
    pages: number;
    mobile: boolean;
    screenshot: boolean;
    timeout: number;
    output: string;
    progress?: (message: string) => void;
}
export declare function audit(input: string, options: Options): Promise<Report>;
