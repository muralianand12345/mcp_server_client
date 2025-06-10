import { Injectable } from '@nestjs/common';
import { OpenAIService } from '../../shared/openai/openai.service';
import { Message } from '../../common/interfaces/message.interface';
import { ConfigService } from '../../config/config.service';

@Injectable()
export class AgentService {
    private chatHistory: Map<string, Array<{ role: 'user' | 'assistant', content: string }>> = new Map();

    constructor(
        private openaiService: OpenAIService,
        private configService: ConfigService
    ) { }

    // Add a message to the chat history
    public addToHistory(sessionId: string, role: 'user' | 'assistant', content: string): void {
        if (!this.chatHistory.has(sessionId)) {
            this.chatHistory.set(sessionId, []);
        }

        const history = this.chatHistory.get(sessionId) || [];
        history.push({ role, content });

        // Keep chat history at a reasonable size
        if (history.length > this.configService.chatHistoryLimit) {
            history.shift();
        }
    }

    // Format chat history for the prompt
    public getSessionHistory(sessionId: string): Array<{ role: 'user' | 'assistant', content: string }> {
        return this.chatHistory.get(sessionId) || [];
    }

    // Clear chat history for a session
    public clearSessionHistory(sessionId: string): void {
        this.chatHistory.delete(sessionId);
    }

    // Build the system prompt with all available context
    private buildSystemPrompt(ragContext: string, toolData: string | null, imageCitation: boolean = true): string {
        let systemPrompt = `
        You are a helpful ticket assistant.
        Your goad is to answer user's questions accurately using available information from RAG Knowledge Base and Tool Execution Data.

        INSTRUCTIONS:
        - Do not answer if the question's answer/information is not in the RAG Knowledge Base or Tool Execution Data.
        - Do not make up information. Only use the information provided in the RAG Knowledge Base and Tool Execution Data. If the information is not available, say "I don't know" or similar phrases.
        - If a image is provided, use it to answer the question. If the image has the answer to user's question, provide the answer using the image. Do not explain the whole image unless the user asks for it.
        `

        if (imageCitation && ragContext && ragContext.length > 0) {
            console.log('Adding image citation instructions to system prompt');
            systemPrompt += `
            \n###Image Citation:
            If the RAG Knowledge Base contains images, cite them in your response. Use the format: 
            - <CIT image_url=IMG_URL>Your answer snippet here</CIT>

            Where:
            - IMG_URL is the URL of the image from the RAG Knowledge Base.
            - Your answer snippet is the part of the answer that is derived from the image.
            - The text inside <CIT> is part of your final answer, not the original content
            - Keep citations minimal and only cite when directly referencing content

            Remember: The text inside <CIT> is your answer's snippet, not the source content itself.
            `
        }

        if (ragContext && ragContext.length > 0) {
            systemPrompt += `
            \n###RAG Knowledge Base Context:
            ${ragContext}
            - Resolution is the answer to problem.
            `
        }

        if (toolData && toolData.length > 0) {
            systemPrompt += `
            \n###Tool Execution Data:
            ${toolData}
            `
        }

        return systemPrompt;
    }

    // Generate a response using the OpenAI API
    public async generateResponse(
        sessionId: string,
        query: string,
        ragContext: string,
        toolData: string | null
    ): Promise<string> {
        try {
            const systemPrompt = this.buildSystemPrompt(ragContext, toolData);
            const history = this.getSessionHistory(sessionId);

            // Build the messages array for the OpenAI API
            const messages: Message[] = [];

            // Add system message
            messages.push({
                role: "system",
                content: systemPrompt
            });

            // Add chat history
            for (const msg of history) {
                messages.push({
                    role: msg.role,
                    content: msg.content
                });
            }

            // Add the current query
            messages.push({
                role: "user",
                content: query
            });

            // Process toolData for images if available
            let toolDataObj: any = null;
            if (toolData) {
                try {
                    toolDataObj = typeof toolData === 'string' ?
                        (toolData.startsWith('{') ? JSON.parse(toolData) : { urls: [], response: toolData })
                        : toolData;

                    const urls = toolDataObj.urls;

                    // Add image URLs to the messages if available
                    if (urls && urls.length > 0) {
                        const imageData = await Promise.all(
                            urls.map(async (url: string) => {
                                try {
                                    const response = await fetch(url);
                                    const buffer = await response.arrayBuffer();
                                    const base64 = Buffer.from(buffer).toString('base64');

                                    return {
                                        url,
                                        base64: `data:image/jpeg;base64,${base64}`,
                                        alt: `Image from ${url.split('/').pop() || 'tool data'}`
                                    };
                                } catch (error) {
                                    console.error(`Error fetching image from URL ${url}: ${error.message}`);
                                    return { url, error: true };
                                }
                            })
                        );

                        const validImages = imageData.filter(img => !img.error);
                        for (const img of validImages) {
                            messages.push({
                                role: "user",
                                content: [
                                    {
                                        type: "image_url",
                                        image_url: {
                                            url: img.base64,
                                            detail: "high"
                                        }
                                    },
                                    {
                                        type: "text",
                                        text: `Image from ${img.url}`
                                    }
                                ]
                            });
                        }
                    }
                } catch (error) {
                    console.warn(`Could not parse tool data as JSON, using as string: ${error.message}`);
                    toolDataObj = { urls: [], response: toolData };
                }
            }

            const response = await this.openaiService.getClient().chat.completions.create({
                model: this.configService.clientOpenAIModel,
                messages: messages as any
            });

            const reply = response.choices[0].message.content || "Sorry, I couldn't generate a response.";

            // Add this interaction to chat history
            this.addToHistory(sessionId, 'user', query);
            this.addToHistory(sessionId, 'assistant', reply);

            return reply;
        } catch (error) {
            console.error(`Error generating response: ${error.message}`);
            return "Sorry, I encountered an error while generating a response.";
        }
    }
}