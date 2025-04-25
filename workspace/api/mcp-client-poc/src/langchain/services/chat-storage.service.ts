import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs';
import * as path from 'path';

export interface RagResultData {
    content: string;
    source: string;
    metadata: Record<string, any>;
}

export interface ChatInteraction {
    timestamp: string;
    sessionId: string;
    query: string;
    ragResults: RagResultData[];
    s3Results: RagResultData[];
    postgresResults: RagResultData[];
    response: string;
}

@Injectable()
export class ChatStorageService {
    private readonly logger = new Logger(ChatStorageService.name);
    private readonly storageDir: string;
    private readonly storageEnabled: boolean;

    constructor(private configService: ConfigService) {
        // Get storage directory from config or use default
        this.storageDir = this.configService.get('app.storage.dir', './chat-logs');
        this.storageEnabled = this.configService.get('app.storage.enabled', true);

        // Create storage directory if it doesn't exist
        if (this.storageEnabled) {
            try {
                if (!fs.existsSync(this.storageDir)) {
                    fs.mkdirSync(this.storageDir, { recursive: true });
                    this.logger.log(`Created chat storage directory: ${this.storageDir}`);
                }
            } catch (error) {
                this.logger.error(`Failed to create storage directory: ${error.message}`);
                this.storageEnabled = false;
            }
        }
    }

    /**
     * Store a chat interaction with all associated data
     */
    async storeInteraction(interaction: Omit<ChatInteraction, 'timestamp'>): Promise<boolean> {
        if (!this.storageEnabled) {
            this.logger.warn('Chat storage is disabled, not saving interaction');
            return false;
        }

        try {
            // Add timestamp
            const fullInteraction: ChatInteraction = {
                ...interaction,
                timestamp: new Date().toISOString(),
            };

            // Create filename based on session ID and timestamp
            const timestamp = new Date().toISOString().replace(/:/g, '-');
            const filename = `${fullInteraction.sessionId}_${timestamp}.json`;
            const filePath = path.join(this.storageDir, filename);

            // Write to file
            fs.writeFileSync(filePath, JSON.stringify(fullInteraction, null, 2));
            this.logger.log(`Stored chat interaction to ${filePath}`);

            // Also append to a session log file
            this.appendToSessionLog(fullInteraction);

            return true;
        } catch (error) {
            this.logger.error(`Failed to store chat interaction: ${error.message}`);
            return false;
        }
    }

    /**
     * Append interaction to a session-specific log file
     */
    private appendToSessionLog(interaction: ChatInteraction): void {
        try {
            const sessionLogPath = path.join(this.storageDir, `session_${interaction.sessionId}.jsonl`);

            // Convert to single line JSON and append to file
            const jsonLine = JSON.stringify({
                timestamp: interaction.timestamp,
                query: interaction.query,
                ragResultCount: interaction.ragResults.length,
                s3ResultCount: interaction.s3Results.length,
                postgresResultCount: interaction.postgresResults.length,
                responsePreview: interaction.response.substring(0, 100) + (interaction.response.length > 100 ? '...' : '')
            }) + '\n';

            fs.appendFileSync(sessionLogPath, jsonLine);
        } catch (error) {
            this.logger.warn(`Failed to append to session log: ${error.message}`);
        }
    }

    /**
     * Get chat history for a specific session
     */
    getSessionHistory(sessionId: string): ChatInteraction[] {
        if (!this.storageEnabled) {
            return [];
        }

        try {
            const sessionLogPath = path.join(this.storageDir, `session_${sessionId}.jsonl`);
            if (!fs.existsSync(sessionLogPath)) {
                return [];
            }

            // Read all individual chat files for this session
            const sessionFiles = fs.readdirSync(this.storageDir)
                .filter(file => file.startsWith(`${sessionId}_`) && file.endsWith('.json'));

            const interactions: ChatInteraction[] = [];

            for (const file of sessionFiles) {
                try {
                    const content = fs.readFileSync(path.join(this.storageDir, file), 'utf8');
                    const interaction = JSON.parse(content) as ChatInteraction;
                    interactions.push(interaction);
                } catch (e) {
                    this.logger.warn(`Failed to read chat file ${file}: ${e.message}`);
                }
            }

            // Sort by timestamp
            return interactions.sort((a, b) =>
                new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
            );
        } catch (error) {
            this.logger.error(`Failed to get session history: ${error.message}`);
            return [];
        }
    }
}