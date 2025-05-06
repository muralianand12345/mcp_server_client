export class ChatResponseDto {
    response: string;
    sessionId: string;
    timestamp: Date;
}

export class TestQueryResponseDto {
    query: string;
    totalResults: number;
    s3Results: number;
    postgresResults: number;
    formattedSources?: Array<{
        source: string;
        contentPreview: string;
    }>;
}