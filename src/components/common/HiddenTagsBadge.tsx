import React from "react";

export interface HiddenTagsBadgeProps {
  hiddenTags: string[];
  lang?: string;
  className?: string;
}

export const HiddenTagsBadge: React.FC<HiddenTagsBadgeProps> = ({
  hiddenTags,
  lang = "vi",
  className = "",
}) => {
  if (!hiddenTags || hiddenTags.length === 0) return null;

  const getAriaLabel = () => {
    switch (lang) {
      case "vi":
        return `${hiddenTags.length} thẻ metadata khác: ${hiddenTags.join(", ")}`;
      case "ja":
        return `他 ${hiddenTags.length} 件のタグ: ${hiddenTags.join(", ")}`;
      case "zh":
        return `其他 ${hiddenTags.length} 个标签: ${hiddenTags.join(", ")}`;
      default:
        return `${hiddenTags.length} other tags: ${hiddenTags.join(", ")}`;
    }
  };

  return (
    <div className="relative inline-flex items-center group/hidden-tags shrink-0">
      {/* Badge Button */}
      <span
        tabIndex={0}
        role="note"
        aria-label={getAriaLabel()}
        className={`inline-flex items-center justify-center h-5 px-1.5 py-0.5 rounded-md bg-surface3/70 text-textMuted hover:text-textPrimary hover:bg-surface3 text-[10px] font-medium border border-borderDefault/50 cursor-default select-none outline-none focus-visible:ring-1 focus-visible:ring-accent transition-colors ${className}`}
      >
        +{hiddenTags.length}
      </span>

      {/* Floating Tooltip anchored ABOVE the badge with only the hidden tags */}
      <div
        role="tooltip"
        className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 pointer-events-none z-40 opacity-0 invisible group-hover/hidden-tags:opacity-100 group-hover/hidden-tags:visible group-focus-within/hidden-tags:opacity-100 group-focus-within/hidden-tags:visible transition-all duration-150 ease-out transform translate-y-1 group-hover/hidden-tags:translate-y-0 group-focus-within/hidden-tags:translate-y-0 flex items-center gap-1 px-1.5 py-1 rounded-lg bg-surface1 text-textPrimary border border-borderDefault shadow-xl whitespace-nowrap text-xs"
      >
        {hiddenTags.map((tag, idx) => (
          <span
            key={idx}
            className="inline-flex items-center h-4.5 px-1.5 py-0.5 rounded bg-surface3/80 text-textSecondary text-[10px] font-medium border border-borderDefault/50 shrink-0"
          >
            {tag}
          </span>
        ))}
        {/* Downward Caret */}
        <div className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-2 h-2 rotate-45 bg-surface1 border-r border-b border-borderDefault" />
      </div>
    </div>
  );
};
