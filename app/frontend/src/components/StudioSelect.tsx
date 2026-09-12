import type { ReactNode } from 'react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

interface Option { value: string; label: string; description?: string; icon?: ReactNode; disabled?: boolean }
interface Props {
  value: string;
  onValueChange: (value: string) => void;
  options: Option[];
  'aria-label': string;
  id?: string;
  disabled?: boolean;
  className?: string;
  compact?: boolean;
  placeholder?: string;
}

/** Consistent studio selects with native keyboard navigation and focus handling. */
export default function StudioSelect({ value, onValueChange, options, 'aria-label': label, id, disabled, className, compact = false, placeholder = '请选择' }: Props) {
  const selected = options.find(option => option.value === value);
  return <Select value={value} onValueChange={onValueChange} disabled={disabled}>
    <SelectTrigger id={id} aria-label={label} className={className} data-size={compact ? 'compact' : 'regular'}>
      <SelectValue placeholder={placeholder}>{selected?.label}</SelectValue>
    </SelectTrigger>
    <SelectContent>
      {options.map(option => <SelectItem key={option.value} value={option.value} disabled={option.disabled} textValue={option.label}>
        <span className="flex items-center gap-2.5">
          {option.icon && <span className="shrink-0 text-muted-foreground">{option.icon}</span>}
          <span className="min-w-0"><span className="block">{option.label}</span>{option.description && <span className="studio-select-description">{option.description}</span>}</span>
        </span>
      </SelectItem>)}
    </SelectContent>
  </Select>;
}
