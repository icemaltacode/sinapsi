import { ChevronDown } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';

import type { ChatModelOption } from '../types/chat';
import { CapabilityIcon } from './CapabilityIcon';

interface ModelSelectorProps {
  models: ChatModelOption[];
  selectedModelId: string | null;
  onModelChange: (modelId: string) => void;
  disabled?: boolean;
}

export function ModelSelector({ models, selectedModelId, onModelChange, disabled }: ModelSelectorProps) {
  const [open, setOpen] = useState(false);
  const selectedModel = models.find((m) => m.id === selectedModelId);
  const containerRef = useRef<HTMLDivElement>(null);

  // Sort models alphabetically by label
  const sortedModels = useMemo(() => {
    return [...models].sort((a, b) => a.label.localeCompare(b.label));
  }, [models]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };

    if (open) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [open]);

  return (
    <div ref={containerRef} className='relative'>
      <button
        type='button'
        className='flex h-11 w-full items-center justify-between rounded-lg border border-border/50 bg-background/80 px-3 text-sm text-foreground shadow-sm hover:bg-background focus-visible:outline-none focus-visible:ring focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50'
        disabled={disabled}
        onClick={() => setOpen(!open)}
      >
        <span>{selectedModel?.label || 'Select model'}</span>
        <ChevronDown className='h-4 w-4 opacity-50' />
      </button>

      {open && (
        <div className='absolute left-0 right-0 z-50 mt-1 max-w-[600px] overflow-hidden rounded-lg border bg-popover shadow-lg'>
          {/* Desktop: Table View */}
          <div className='hidden max-h-[400px] overflow-auto md:block'>
            <table className='w-full table-fixed'>
              <thead className='sticky top-0 bg-background'>
                <tr className='border-b text-left text-xs text-muted-foreground'>
                  <th className='w-[35%] p-3 font-medium'>Model</th>
                  <th className='w-[16%] p-3 text-center font-medium'>Image</th>
                  <th className='w-[16%] p-3 text-center font-medium'>TTS</th>
                  <th className='w-[16%] p-3 text-center font-medium'>Trans</th>
                  <th className='w-[17%] p-3 text-center font-medium'>Files</th>
                </tr>
              </thead>
              <tbody>
                {sortedModels.map((model) => (
                  <tr
                    key={model.id}
                    className={`cursor-pointer border-b hover:bg-accent/50 ${model.id === selectedModelId ? 'bg-accent' : ''}`}
                    onClick={() => {
                      onModelChange(model.id);
                      setOpen(false);
                    }}
                  >
                    <td className='p-3 text-sm'>{model.label}</td>
                    <td className='p-3 text-center'>
                      <div className='flex justify-center'>
                        <CapabilityIcon value={model.supportsImageGeneration} title='Image Generation' />
                      </div>
                    </td>
                    <td className='p-3 text-center'>
                      <div className='flex justify-center'>
                        <CapabilityIcon value={model.supportsTTS} title='Text-to-Speech' />
                      </div>
                    </td>
                    <td className='p-3 text-center'>
                      <div className='flex justify-center'>
                        <CapabilityIcon value={model.supportsTranscription} title='Transcription' />
                      </div>
                    </td>
                    <td className='p-3 text-center'>
                      <div className='flex justify-center'>
                        <CapabilityIcon value={model.supportsFileUpload} title='File Upload' />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile: Card View */}
          <div className='max-h-[400px] overflow-auto md:hidden'>
            {sortedModels.map((model) => (
              <button
                key={model.id}
                type='button'
                className={`w-full border-b p-4 text-left hover:bg-accent/50 ${model.id === selectedModelId ? 'bg-accent' : ''}`}
                onClick={() => {
                  onModelChange(model.id);
                  setOpen(false);
                }}
              >
                <div className='mb-2 truncate font-medium'>{model.label}</div>
                <div className='grid grid-cols-4 gap-1 text-xs text-muted-foreground'>
                  <div className='flex items-center gap-1'>
                    <CapabilityIcon value={model.supportsImageGeneration} />
                    <span className='truncate'>Image</span>
                  </div>
                  <div className='flex items-center gap-1'>
                    <CapabilityIcon value={model.supportsTTS} />
                    <span className='truncate'>TTS</span>
                  </div>
                  <div className='flex items-center gap-1'>
                    <CapabilityIcon value={model.supportsTranscription} />
                    <span className='truncate'>Trans</span>
                  </div>
                  <div className='flex items-center gap-1'>
                    <CapabilityIcon value={model.supportsFileUpload} />
                    <span className='truncate'>Files</span>
                  </div>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
