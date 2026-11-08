export type SchemaKind = 'FAQPage' | 'HowTo' | 'Article' | 'Organization';
export interface SchemaAssessment {
    count: number;
    score: number | null;
    missing: string[];
}
export declare function assessSchemas(blocks: unknown[]): Record<SchemaKind, SchemaAssessment>;
export interface CitabilityInput {
    words: number;
    sentences: number;
    headings: number;
    skippedHeadings: number;
    h1: number;
    paragraphs: number;
    namedEntities: number;
    author: boolean;
    published: boolean;
    updated: boolean;
    externalLinks: number;
}
export declare function citability(i: CitabilityInput): {
    score: number;
    components: {
        clarity: number;
        entity: number;
        context: number;
        structure: number;
    };
    evidence: {
        averageSentenceWords: number | null;
        namedEntitySignals: number;
        namedEntitySignalsPer100Words: number;
    };
};
