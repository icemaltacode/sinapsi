import { FileText, Image as ImageIcon, Loader2, X } from 'lucide-react';
import { Button } from './ui/button';
import { cn } from '../lib/utils';

export interface PendingFileUpload {
  file: File;
  fileKey?: string;
  uploadProgress: number;
  error?: string;
  previewUrl?: string;
}

interface FileUploadPreviewProps {
  files: PendingFileUpload[];
  onRemove: (index: number) => void;
  className?: string;
}

const formatFileSize = (bytes: number): string => {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
};

export function FileUploadPreview({ files, onRemove, className }: FileUploadPreviewProps) {
  if (files.length === 0) return null;

  return (
    <div className={cn('flex gap-2 overflow-x-auto pb-2', className)}>
      {files.map((pendingFile, index) => {
        const isImage = pendingFile.file.type.startsWith('image/');
        const isUploading = pendingFile.uploadProgress > 0 && pendingFile.uploadProgress < 100;
        const isComplete = pendingFile.uploadProgress === 100;
        const hasError = !!pendingFile.error;

        return (
          <div
            key={`${pendingFile.file.name}-${index}`}
            className={cn(
              'relative flex h-24 w-24 flex-shrink-0 flex-col items-center justify-center rounded-lg border bg-background/80 p-2 shadow-sm',
              hasError && 'border-destructive',
              isComplete && 'border-green-500/50'
            )}
          >
            {/* Remove button */}
            <Button
              type='button'
              variant='ghost'
              size='icon'
              className='absolute -right-2 -top-2 h-6 w-6 rounded-full border border-border bg-background shadow-md hover:bg-destructive hover:text-destructive-foreground'
              onClick={() => onRemove(index)}
            >
              <X className='h-3 w-3' />
            </Button>

            {/* Preview or icon */}
            <div className='relative flex h-12 w-12 items-center justify-center overflow-hidden rounded'>
              {isImage && pendingFile.previewUrl ? (
                <img
                  src={pendingFile.previewUrl}
                  alt={pendingFile.file.name}
                  className='h-full w-full object-cover'
                />
              ) : isImage ? (
                <ImageIcon className='h-6 w-6 text-muted-foreground' />
              ) : (
                <FileText className='h-6 w-6 text-muted-foreground' />
              )}

              {/* Upload progress overlay */}
              {isUploading && (
                <div className='absolute inset-0 flex items-center justify-center bg-background/80'>
                  <Loader2 className='h-5 w-5 animate-spin text-primary' />
                </div>
              )}
            </div>

            {/* File info */}
            <div className='mt-1 w-full text-center'>
              <p className='truncate text-[0.65rem] font-medium text-foreground'>
                {pendingFile.file.name}
              </p>
              <p className='text-[0.6rem] text-muted-foreground'>
                {formatFileSize(pendingFile.file.size)}
              </p>
              {hasError && (
                <p className='text-[0.6rem] text-destructive'>Error</p>
              )}
              {isUploading && (
                <p className='text-[0.6rem] text-primary'>{pendingFile.uploadProgress}%</p>
              )}
            </div>

            {/* Progress bar */}
            {isUploading && (
              <div className='absolute bottom-0 left-0 right-0 h-1 overflow-hidden rounded-b-lg bg-muted'>
                <div
                  className='h-full bg-primary transition-all'
                  style={{ width: `${pendingFile.uploadProgress}%` }}
                />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
