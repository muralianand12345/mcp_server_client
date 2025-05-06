export interface Metadata {
    data: any;
    resolution: any;
    createdAt: Date;
}

export interface RagResult {
    content: string;
    ticketId: string;
    subject: string;
    metadata: Array<Metadata>;
}

export interface RagData {
    query: string;
    ragResult: RagResult[];
}

export interface ToolResponse {
    urls: string[];
    response: string;
}