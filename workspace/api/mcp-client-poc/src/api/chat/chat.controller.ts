import { Controller, Post, Body, Headers, Delete, HttpException, HttpStatus } from '@nestjs/common';
import { ChatService } from './chat.service';
import { ChatInputDto } from './dto/chat-input.dto';
import { ChatResponseDto } from './dto/chat-response.dto';

@Controller('chat')
export class ChatController {
    constructor(private chatService: ChatService) { }

    @Post()
    async chat(
        @Headers('session-id') sessionId: string,
        @Body() chatInputDto: ChatInputDto,
    ): Promise<ChatResponseDto> {
        if (!sessionId) {
            throw new HttpException('Session ID is required', HttpStatus.BAD_REQUEST);
        }

        try {
            const response = await this.chatService.processChat(
                sessionId,
                chatInputDto.message,
            );

            return { response };
        } catch (error) {
            throw new HttpException(
                `Error processing chat: ${error.message}`,
                HttpStatus.INTERNAL_SERVER_ERROR,
            );
        }
    }

    @Delete()
    clearChat(@Headers('session-id') sessionId: string): void {
        if (!sessionId) {
            throw new HttpException('Session ID is required', HttpStatus.BAD_REQUEST);
        }

        this.chatService.clearChatHistory(sessionId);
    }
}