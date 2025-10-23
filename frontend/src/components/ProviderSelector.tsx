import { ChevronDown } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import type { ChatProviderOption } from '../types/chat';

interface ProviderSelectorProps {
  providers: ChatProviderOption[];
  selectedProviderId: string | null;
  onProviderChange: (providerId: string) => void;
  disabled?: boolean;
}

export function ProviderSelector({
  providers,
  selectedProviderId,
  onProviderChange,
  disabled
}: ProviderSelectorProps) {
  const [open, setOpen] = useState(false);
  const selectedProvider = providers.find((p) => p.providerId === selectedProviderId);
  const containerRef = useRef<HTMLDivElement>(null);

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
        <span>{selectedProvider?.instanceName || 'Select provider'}</span>
        <ChevronDown className='h-4 w-4 opacity-50' />
      </button>

      {open && (
        <div className='absolute left-0 right-0 z-50 mt-1 max-w-[500px] overflow-hidden rounded-lg border bg-popover shadow-lg'>
          {/* Desktop: Table View */}
          <div className='hidden max-h-[400px] overflow-auto md:block'>
            <table className='w-full table-fixed'>
              <thead className='sticky top-0 bg-background'>
                <tr className='border-b text-left text-xs text-muted-foreground'>
                  <th className='w-[50%] p-3 font-medium'>Provider</th>
                  <th className='w-[30%] p-3 font-medium'>Type</th>
                  <th className='w-[20%] p-3 text-right font-medium'>Models</th>
                </tr>
              </thead>
              <tbody>
                {providers.map((provider) => (
                  <tr
                    key={provider.providerId}
                    className={`cursor-pointer border-b hover:bg-accent/50 ${provider.providerId === selectedProviderId ? 'bg-accent' : ''}`}
                    onClick={() => {
                      onProviderChange(provider.providerId);
                      setOpen(false);
                    }}
                  >
                    <td className='p-3 text-sm'>{provider.instanceName}</td>
                    <td className='p-3 text-sm text-muted-foreground'>{provider.providerType}</td>
                    <td className='p-3 text-right text-sm text-muted-foreground'>{provider.models.length}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile: Card View */}
          <div className='max-h-[400px] overflow-auto md:hidden'>
            {providers.map((provider) => (
              <button
                key={provider.providerId}
                type='button'
                className={`w-full border-b p-4 text-left hover:bg-accent/50 ${provider.providerId === selectedProviderId ? 'bg-accent' : ''}`}
                onClick={() => {
                  onProviderChange(provider.providerId);
                  setOpen(false);
                }}
              >
                <div className='mb-1 truncate font-medium'>{provider.instanceName}</div>
                <div className='flex items-center justify-between text-xs text-muted-foreground'>
                  <span className='truncate'>{provider.providerType}</span>
                  <span className='ml-2 flex-shrink-0'>{provider.models.length} models</span>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
