export type MessageContent =
    | string
    | { type: 'text'; text: string }[]
    | { type: 'image_url'; image_url: { url: string; detail: 'low' | 'high' | 'auto' } }[]
    | (
        | { type: 'text'; text: string }
        | { type: 'image_url'; image_url: { url: string; detail: 'low' | 'high' | 'auto' } }
    )[];

export interface Message {
    role: 'system' | 'user' | 'assistant' | 'function';
    content: MessageContent;
    name?: string;
}