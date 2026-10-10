interface SectionHeaderProps {
  title: string;
  count?: number;
}

export function SectionHeader({ title, count }: SectionHeaderProps) {
  return (
    <div className="mb-3.5 flex items-center gap-2">
      {/* Poster label (display face, coral slash), as in settings sections. */}
      <h3 className="poster-label text-[17px] leading-tight text-fg">{title}</h3>
      {count !== undefined && count > 0 && (
        <span className="numeral rounded-full bg-tint/[0.07] px-2 py-0.5 text-[11.5px] text-fg-soft">
          {count}
        </span>
      )}
    </div>
  );
}
