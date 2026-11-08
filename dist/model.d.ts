export type Category = 'seo' | 'aeo' | 'performance' | 'accessibility' | 'security' | 'mobile';
export type Severity = 'high' | 'medium' | 'low' | 'info';
export interface Finding {
    id: string;
    category: Category;
    severity: Severity;
    priority: 'high' | 'medium' | 'low';
    estimated_effort: 'low' | 'medium' | 'high';
    suggested_fix: string;
    title: string;
    detail: string;
    recommendation: string;
    url: string;
}
export interface PageResult {
    url: string;
    status: number | null;
    title: string;
    metrics: Record<string, unknown>;
    findings: Finding[];
    redirects: string[];
    screenshot?: string;
}
export interface Report {
    executive_summary: string[];
    schemaVersion: '1.1';
    requestedUrl: string;
    generatedAt: string;
    durationMs: number;
    scores: Record<Category | 'overall' | 'ai_citability', number | null>;
    pages: PageResult[];
    prioritizedFixes: Finding[];
    warnings: string[];
}
export declare const categories: Category[];
export declare function score(findings: Finding[], pageCount: number, mobileComplete?: boolean): Report['scores'];
export declare function prioritize(findings: Finding[]): Finding[];
export declare function normalizeUrl(value: string): string;
