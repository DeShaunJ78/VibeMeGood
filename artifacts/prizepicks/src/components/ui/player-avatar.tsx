import { useMemo, useState } from "react";

function nameToColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue}, 40%, 28%)`;
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

const SIZE_MAP = {
  xs: "w-5 h-5 text-[8px]",
  sm: "w-7 h-7 text-[10px]",
  md: "w-9 h-9 text-xs",
  lg: "w-12 h-12 text-sm",
};

interface PlayerAvatarProps {
  name: string;
  imageUrl?: string | null;
  size?: keyof typeof SIZE_MAP;
  className?: string;
}

export function PlayerAvatar({ name, imageUrl, size = "sm", className = "" }: PlayerAvatarProps) {
  const [imgError, setImgError] = useState(false);
  const bgColor = useMemo(() => nameToColor(name), [name]);
  const inits = useMemo(() => initials(name), [name]);
  const sizeClass = SIZE_MAP[size];

  if (imageUrl && !imgError) {
    return (
      <img
        src={imageUrl}
        alt={name}
        loading="lazy"
        referrerPolicy="no-referrer"
        onError={() => setImgError(true)}
        className={`rounded-full object-cover shrink-0 ${sizeClass} ${className}`}
      />
    );
  }

  return (
    <div
      className={`rounded-full flex items-center justify-center font-bold shrink-0 ${sizeClass} ${className}`}
      style={{ backgroundColor: bgColor }}
      title={name}
    >
      <span className="text-white/90 leading-none">{inits}</span>
    </div>
  );
}
