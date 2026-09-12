import {Avatar, AvatarFallback, AvatarImage} from '@/components/ui/avatar';

export default function AccountAvatar({src, name, className = 'h-8 w-8'}: {src?: string; name: string; className?: string}) {
  return <Avatar className={`shrink-0 ${className}`}>
    <AvatarImage src={src || undefined} alt={`${name}的头像`} className="object-cover"/>
    <AvatarFallback className="bg-primary/10 font-semibold text-primary">{[...name.trim()][0]?.toUpperCase() || '我'}</AvatarFallback>
  </Avatar>;
}
