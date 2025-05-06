import { IsNotEmpty, IsString, IsOptional } from 'class-validator';

export class ChatRequestDto {
    @IsNotEmpty()
    @IsString()
    message: string;

    @IsOptional()
    @IsString()
    sessionId?: string;
}