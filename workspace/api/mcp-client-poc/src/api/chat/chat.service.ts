import { Injectable, Logger } from '@nestjs/common';
import { HumanMessage, AIMessage } from '@langchain/core/messages';
import { ReactAgentService } from '../../langchain/agents/react-agent.service';
import { RagService, RagQueryResults } from '../../langchain/services/rag.service';
import { ChatStorageService } from '../../langchain/services/chat-storage.service';

@Injectable()
export class ChatService {
    private chatHistories: Map<string, (HumanMessage | AIMessage)[]> = new Map();
    private readonly logger = new Logger(ChatService.name);

    constructor(
        private reactAgentService: ReactAgentService,
        private ragService: RagService,
        private chatStorageService: ChatStorageService
    ) { }

    async processChat(sessionId: string, message: string): Promise<string> {
        try {
            // Get or create chat history for this session
            if (!this.chatHistories.has(sessionId)) {
                this.chatHistories.set(sessionId, []);
            }

            const chatHistory = this.chatHistories.get(sessionId)!;

            // Add user message to history
            const userMessage = new HumanMessage(message);
            chatHistory.push(userMessage);

            // Retrieve RAG results with separate tracking of sources
            const ragResults: RagQueryResults = await this.ragService.retrieveRelevantInfo(message);

            // Process with RAG-enhanced agent
            const { response, lastMessage } = await this.reactAgentService.processMessage(chatHistory);

            // Add bot message to history
            chatHistory.push(lastMessage);

            // Store the chat interaction with all associated data
            await this.chatStorageService.storeInteraction({
                sessionId,
                query: message,
                ragResults: ragResults.combinedResults,
                s3Results: ragResults.s3Results,
                postgresResults: ragResults.postgresResults,
                response
            });

            return response;
        } catch (error) {
            this.logger.error(`Error processing chat: ${error.message}`);
            throw error;
        }
    }

    clearChatHistory(sessionId: string): void {
        this.chatHistories.delete(sessionId);
    }

    /**
     * Retrieve stored chat history for a session
     */
    async getChatHistory(sessionId: string) {
        return this.chatStorageService.getSessionHistory(sessionId);
    }
}