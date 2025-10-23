import { Check, Loader2, X } from 'lucide-react';

interface CapabilityIconProps {
  value: boolean | null | undefined;
  title?: string;
}

export function CapabilityIcon({ value, title }: CapabilityIconProps) {
  if (value === null || value === undefined) {
    return (
      <span title={title}>
        <Loader2 className='h-4 w-4 animate-spin text-blue-400' />
      </span>
    );
  }
  if (value === true) {
    return (
      <span title={title}>
        <Check className='h-4 w-4 text-green-500' />
      </span>
    );
  }
  return (
    <span title={title}>
      <X className='h-4 w-4 text-muted-foreground' />
    </span>
  );
}
