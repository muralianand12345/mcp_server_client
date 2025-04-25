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
    ) {
        this.logger.log('ChatService initialized');
    }

    async processChat(sessionId: string, message: string): Promise<string> {
        try {
            this.logger.log(`Processing chat for session ${sessionId.substring(0, 8)}...`);

            // Get or create chat history for this session
            if (!this.chatHistories.has(sessionId)) {
                this.logger.log(`Creating new chat history for session ${sessionId.substring(0, 8)}`);
                this.chatHistories.set(sessionId, []);
            }

            const chatHistory = this.chatHistories.get(sessionId)!;
            this.logger.log(`Current chat history has ${chatHistory.length} messages`);

            // Add user message to history
            const userMessage = new HumanMessage(message);
            chatHistory.push(userMessage);

            // Log the start of RAG retrieval
            this.logger.log(`Starting RAG retrieval for query: "${message.substring(0, 50)}${message.length > 50 ? '...' : ''}"`);

            // Retrieve RAG results with separate tracking of sources
            const startRagTime = Date.now();
            const ragResults: RagQueryResults = await this.ragService.retrieveRelevantInfo(message);
            const ragDuration = Date.now() - startRagTime;

            // Log RAG retrieval results
            this.logger.log(`RAG retrieval completed in ${ragDuration}ms`);
            this.logger.log(`- Total results: ${ragResults.combinedResults.length}`);
            this.logger.log(`- S3 results: ${ragResults.s3Results.length}`);
            this.logger.log(`- Postgres results: ${ragResults.postgresResults.length}`);

            // Log source information for debugging
            if (ragResults.combinedResults.length > 0) {
                this.logger.log('Retrieved sources:');
                ragResults.combinedResults.forEach((result, index) => {
                    this.logger.log(`${index + 1}. ${result.source} (${result.content.length} chars)`);
                });
            } else {
                this.logger.warn('No RAG results found. This may affect the quality of the response.');
            }

            // Process with RAG-enhanced agent
            this.logger.log('Processing with ReactAgentService...');
            const startProcessTime = Date.now();
            const { response, lastMessage } = await this.reactAgentService.processMessage(chatHistory);
            const processDuration = Date.now() - startProcessTime;
            this.logger.log(`Agent processing completed in ${processDuration}ms`);

            // Add bot message to history
            chatHistory.push(lastMessage);

            // Store the chat interaction with all associated data
            try {
                await this.chatStorageService.storeInteraction({
                    sessionId,
                    query: message,
                    ragResults: ragResults.combinedResults,
                    s3Results: ragResults.s3Results,
                    postgresResults: ragResults.postgresResults,
                    response
                });
                this.logger.log('Chat interaction stored successfully');
            } catch (error) {
                this.logger.error(`Error storing chat interaction: ${error.message}`);
            }

            return response;
        } catch (error) {
            this.logger.error(`Error processing chat: ${error.message}`, error.stack);
            throw error;
        }
    }

    clearChatHistory(sessionId: string): void {
        this.logger.log(`Clearing chat history for session ${sessionId.substring(0, 8)}`);
        this.chatHistories.delete(sessionId);
    }

    /**
     * Retrieve stored chat history for a session
     */
    async getChatHistory(sessionId: string) {
        this.logger.log(`Retrieving chat history for session ${sessionId.substring(0, 8)}`);
        return this.chatStorageService.getSessionHistory(sessionId);
    }

    /**
     * Get diagnostic information about the current state of the service
     */
    async getDiagnostics() {
        const diagnostics = {
            activeChats: this.chatHistories.size,
            totalMessages: [...this.chatHistories.values()].reduce(
                (sum, history) => sum + history.length, 0
            ),
            timestamp: new Date().toISOString()
        };

        return diagnostics;
    }
}