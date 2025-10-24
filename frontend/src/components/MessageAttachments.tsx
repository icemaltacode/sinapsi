import { FileText, Image as ImageIcon } from 'lucide-react';
import type { FileAttachment } from '../types/chat';
import { cn } from '../lib/utils';

interface MessageAttachmentsProps {
  attachments: FileAttachment[];
  className?: string;
}

const formatFileSize = (bytes: number): string => {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
};

export function MessageAttachments({ attachments, className }: MessageAttachmentsProps) {
  if (!attachments || attachments.length === 0) return null;

  return (
    <div className={cn('flex gap-2 overflow-x-auto', className)}>
      {attachments.map((attachment, index) => {
        const isImage = attachment.fileType.startsWith('image/');

        return (
          <div
            key={`${attachment.fileKey}-${index}`}
            className='flex h-20 w-20 flex-shrink-0 flex-col items-center justify-center rounded-lg border border-border/50 bg-background/60 p-2 shadow-sm'
          >
            {/* Icon or image thumbnail */}
            <div className='flex h-10 w-10 items-center justify-center overflow-hidden rounded'>
              {isImage ? (
                <ImageIcon className='h-5 w-5 text-muted-foreground' />
              ) : (
                <FileText className='h-5 w-5 text-muted-foreground' />
              )}
            </div>

            {/* File info */}
            <div className='mt-1 w-full text-center'>
              <p className='truncate text-[0.6rem] font-medium text-foreground' title={attachment.fileName}>
                {attachment.fileName}
              </p>
              <p className='text-[0.55rem] text-muted-foreground'>
                {formatFileSize(attachment.fileSize)}
              </p>
            </div>
          </div>
        );
      })}
    </div>
  );
}
