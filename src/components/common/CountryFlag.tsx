import React from "react";

export interface CountryFlagProps {
  countryCode?: string;
  className?: string;
  title?: string;
}

export const CountryFlag: React.FC<CountryFlagProps> = ({
  countryCode = "vn",
  className = "w-4 h-3 rounded-[2px] shadow-xs shrink-0 overflow-hidden",
  title,
}) => {
  const code = (countryCode || "").toLowerCase();

  // Render vector SVG for maximum crispness and consistent cross-platform colors
  const renderSvg = () => {
    switch (code) {
      case "vn":
      case "vi":
        return (
          <svg viewBox="0 0 30 20" className="w-full h-full block">
            <rect width="30" height="20" fill="#da251d" />
            {/* Standard 5-pointed gold star centered precisely at (15, 10) */}
            <polygon
              fill="#ffff00"
              points="15,4 16.35,8.15 20.71,8.15 17.18,10.71 18.53,14.85 15,12.29 11.47,14.85 12.82,10.71 9.29,8.15 13.65,8.15"
            />
          </svg>
        );

      case "us":
      case "en":
        return (
          <svg viewBox="0 0 30 20" className="w-full h-full block">
            {/* 13 stripes */}
            <rect width="30" height="20" fill="#b22234" />
            <rect y="1.54" width="30" height="1.54" fill="#ffffff" />
            <rect y="4.62" width="30" height="1.54" fill="#ffffff" />
            <rect y="7.69" width="30" height="1.54" fill="#ffffff" />
            <rect y="10.77" width="30" height="1.54" fill="#ffffff" />
            <rect y="13.85" width="30" height="1.54" fill="#ffffff" />
            <rect y="16.92" width="30" height="1.54" fill="#ffffff" />
            {/* Canton */}
            <rect width="12" height="10.77" fill="#3c3b6e" />
            {/* Simplified 5 star dots */}
            <circle cx="2.5" cy="2.2" r="0.7" fill="#ffffff" />
            <circle cx="6" cy="2.2" r="0.7" fill="#ffffff" />
            <circle cx="9.5" cy="2.2" r="0.7" fill="#ffffff" />
            <circle cx="4.25" cy="5.3" r="0.7" fill="#ffffff" />
            <circle cx="7.75" cy="5.3" r="0.7" fill="#ffffff" />
            <circle cx="2.5" cy="8.4" r="0.7" fill="#ffffff" />
            <circle cx="6" cy="8.4" r="0.7" fill="#ffffff" />
            <circle cx="9.5" cy="8.4" r="0.7" fill="#ffffff" />
          </svg>
        );

      case "gb":
        return (
          <svg viewBox="0 0 30 20" className="w-full h-full block">
            <rect width="30" height="20" fill="#012169" />
            {/* White diagonals */}
            <line x1="0" y1="0" x2="30" y2="20" stroke="#ffffff" strokeWidth="3.5" />
            <line x1="30" y1="0" x2="0" y2="20" stroke="#ffffff" strokeWidth="3.5" />
            {/* Red diagonals */}
            <line x1="0" y1="0" x2="30" y2="20" stroke="#c8102e" strokeWidth="1.8" />
            <line x1="30" y1="0" x2="0" y2="20" stroke="#c8102e" strokeWidth="1.8" />
            {/* White cross */}
            <rect x="12" y="0" width="6" height="20" fill="#ffffff" />
            <rect x="0" y="7" width="30" height="6" fill="#ffffff" />
            {/* Red cross */}
            <rect x="13.2" y="0" width="3.6" height="20" fill="#c8102e" />
            <rect x="0" y="8.2" width="30" height="3.6" fill="#c8102e" />
          </svg>
        );

      case "au":
        return (
          <svg viewBox="0 0 30 20" className="w-full h-full block">
            <rect width="30" height="20" fill="#00008b" />
            {/* Mini Union Jack canton */}
            <g transform="scale(0.45)">
              <rect width="30" height="20" fill="#012169" />
              <line x1="0" y1="0" x2="30" y2="20" stroke="#ffffff" strokeWidth="3.5" />
              <line x1="30" y1="0" x2="0" y2="20" stroke="#ffffff" strokeWidth="3.5" />
              <line x1="0" y1="0" x2="30" y2="20" stroke="#c8102e" strokeWidth="1.8" />
              <line x1="30" y1="0" x2="0" y2="20" stroke="#c8102e" strokeWidth="1.8" />
              <rect x="12" y="0" width="6" height="20" fill="#ffffff" />
              <rect x="0" y="7" width="30" height="6" fill="#ffffff" />
              <rect x="13.2" y="0" width="3.6" height="20" fill="#c8102e" />
              <rect x="0" y="8.2" width="30" height="3.6" fill="#c8102e" />
            </g>
            {/* Commonwealth Star & Southern Cross */}
            <circle cx="7" cy="15" r="1.5" fill="#ffffff" />
            <circle cx="23" cy="4" r="0.7" fill="#ffffff" />
            <circle cx="25" cy="8" r="0.7" fill="#ffffff" />
            <circle cx="21" cy="10" r="0.7" fill="#ffffff" />
            <circle cx="23" cy="16" r="0.9" fill="#ffffff" />
            <circle cx="24" cy="12" r="0.5" fill="#ffffff" />
          </svg>
        );

      case "jp":
      case "ja":
        return (
          <svg viewBox="0 0 30 20" className="w-full h-full block">
            <rect width="30" height="20" fill="#ffffff" />
            <circle cx="15" cy="10" r="6" fill="#bc002d" />
          </svg>
        );

      case "cn":
      case "zh":
        return (
          <svg viewBox="0 0 30 20" className="w-full h-full block">
            <rect width="30" height="20" fill="#de2910" />
            {/* Big star */}
            <polygon
              fill="#ffde00"
              points="5,2 5.9,4.8 8.8,4.8 6.4,6.5 7.3,9.3 5,7.6 2.7,9.3 3.6,6.5 1.2,4.8 4.1,4.8"
            />
            {/* 4 small stars */}
            <circle cx="10" cy="2.5" r="0.6" fill="#ffde00" />
            <circle cx="12" cy="4.5" r="0.6" fill="#ffde00" />
            <circle cx="12" cy="7.5" r="0.6" fill="#ffde00" />
            <circle cx="10" cy="9.5" r="0.6" fill="#ffde00" />
          </svg>
        );

      case "kr":
      case "ko":
        return (
          <svg viewBox="0 0 30 20" className="w-full h-full block">
            <rect width="30" height="20" fill="#ffffff" />
            {/* Taegeuk */}
            <circle cx="15" cy="10" r="4.5" fill="#0047a0" />
            <path d="M 10.5,10 A 4.5,4.5 0 0,1 19.5,10 A 2.25,2.25 0 0,1 15,10 A 2.25,2.25 0 0,0 10.5,10 Z" fill="#cd2e3a" />
            <circle cx="12.75" cy="10" r="2.25" fill="#cd2e3a" />
            <circle cx="17.25" cy="10" r="2.25" fill="#0047a0" />
          </svg>
        );

      case "es":
        return (
          <svg viewBox="0 0 30 20" className="w-full h-full block">
            <rect width="30" height="5" fill="#aa151b" />
            <rect y="5" width="30" height="10" fill="#f1bf00" />
            <rect y="15" width="30" height="5" fill="#aa151b" />
            {/* Simplified coat-of-arms accent */}
            <rect x="6" y="8" width="3" height="4" fill="#aa151b" rx="0.5" />
          </svg>
        );

      case "fr":
        return (
          <svg viewBox="0 0 30 20" className="w-full h-full block">
            <rect x="0" width="10" height="20" fill="#002395" />
            <rect x="10" width="10" height="20" fill="#ffffff" />
            <rect x="20" width="10" height="20" fill="#ed2939" />
          </svg>
        );

      case "de":
        return (
          <svg viewBox="0 0 30 20" className="w-full h-full block">
            <rect x="0" y="0" width="30" height="6.67" fill="#000000" />
            <rect x="0" y="6.67" width="30" height="6.67" fill="#dd0000" />
            <rect x="0" y="13.34" width="30" height="6.67" fill="#ffce00" />
          </svg>
        );

      case "it":
        return (
          <svg viewBox="0 0 30 20" className="w-full h-full block">
            <rect x="0" width="10" height="20" fill="#009246" />
            <rect x="10" width="10" height="20" fill="#ffffff" />
            <rect x="20" width="10" height="20" fill="#ce2b37" />
          </svg>
        );

      case "ru":
        return (
          <svg viewBox="0 0 30 20" className="w-full h-full block">
            <rect x="0" y="0" width="30" height="6.67" fill="#ffffff" />
            <rect x="0" y="6.67" width="30" height="6.67" fill="#0039a6" />
            <rect x="0" y="13.34" width="30" height="6.67" fill="#d52b1e" />
          </svg>
        );

      case "id":
        return (
          <svg viewBox="0 0 30 20" className="w-full h-full block">
            <rect x="0" y="0" width="30" height="10" fill="#ce1126" />
            <rect x="0" y="10" width="30" height="10" fill="#ffffff" />
          </svg>
        );

      case "pl":
        return (
          <svg viewBox="0 0 30 20" className="w-full h-full block">
            <rect x="0" y="0" width="30" height="10" fill="#ffffff" />
            <rect x="0" y="10" width="30" height="10" fill="#dc143c" />
          </svg>
        );

      case "nl":
        return (
          <svg viewBox="0 0 30 20" className="w-full h-full block">
            <rect x="0" y="0" width="30" height="6.67" fill="#ae1c28" />
            <rect x="0" y="6.67" width="30" height="6.67" fill="#ffffff" />
            <rect x="0" y="13.34" width="30" height="6.67" fill="#21468b" />
          </svg>
        );

      case "pt":
        return (
          <svg viewBox="0 0 30 20" className="w-full h-full block">
            <rect x="0" width="12" height="20" fill="#006600" />
            <rect x="12" width="18" height="20" fill="#ff0000" />
            <circle cx="12" cy="10" r="3" fill="#ffff00" />
          </svg>
        );

      case "tr":
        return (
          <svg viewBox="0 0 30 20" className="w-full h-full block">
            <rect width="30" height="20" fill="#e30a17" />
            <circle cx="12" cy="10" r="4.5" fill="#ffffff" />
            <circle cx="13.2" cy="10" r="3.6" fill="#e30a17" />
            <polygon
              fill="#ffffff"
              points="17,10 18.2,10.9 17.7,12.3 19,11.4 20.3,12.3 19.8,10.9 21,10 19.6,10 19,8.7 18.4,10"
              transform="scale(0.8) translate(4.5, 2)"
            />
          </svg>
        );

      case "se":
      case "sv":
        return (
          <svg viewBox="0 0 30 20" className="w-full h-full block">
            <rect width="30" height="20" fill="#006aa7" />
            <rect x="9" y="0" width="4" height="20" fill="#fecc00" />
            <rect x="0" y="8" width="30" height="4" fill="#fecc00" />
          </svg>
        );

      case "th":
        return (
          <svg viewBox="0 0 30 20" className="w-full h-full block">
            <rect y="0" width="30" height="3.33" fill="#a51931" />
            <rect y="3.33" width="30" height="3.33" fill="#f4f5f8" />
            <rect y="6.66" width="30" height="6.68" fill="#2d2a4a" />
            <rect y="13.34" width="30" height="3.33" fill="#f4f5f8" />
            <rect y="16.67" width="30" height="3.33" fill="#a51931" />
          </svg>
        );

      case "sa":
      case "ar":
        return (
          <svg viewBox="0 0 30 20" className="w-full h-full block">
            <rect width="30" height="20" fill="#165d31" />
            <rect x="7" y="14" width="16" height="1.2" fill="#ffffff" rx="0.5" />
            <circle cx="15" cy="8" r="2.5" fill="#ffffff" />
          </svg>
        );

      case "in":
      case "hi":
      case "ta":
        return (
          <svg viewBox="0 0 30 20" className="w-full h-full block">
            <rect y="0" width="30" height="6.67" fill="#ff9933" />
            <rect y="6.67" width="30" height="6.67" fill="#ffffff" />
            <rect y="13.34" width="30" height="6.67" fill="#128807" />
            <circle cx="15" cy="10" r="2.2" stroke="#000080" strokeWidth="0.8" fill="none" />
          </svg>
        );

      case "ph":
      case "fil":
        return (
          <svg viewBox="0 0 30 20" className="w-full h-full block">
            <rect y="0" width="30" height="10" fill="#0038a8" />
            <rect y="10" width="30" height="10" fill="#ce1126" />
            <polygon points="0,0 15,10 0,20" fill="#ffffff" />
            <circle cx="5" cy="10" r="2" fill="#fcd116" />
          </svg>
        );

      case "ua":
      case "uk":
        return (
          <svg viewBox="0 0 30 20" className="w-full h-full block">
            <rect y="0" width="30" height="10" fill="#0057b7" />
            <rect y="10" width="30" height="10" fill="#ffd700" />
          </svg>
        );

      default:
        // Generic crisp globe
        return (
          <svg viewBox="0 0 30 20" className="w-full h-full block">
            <rect width="30" height="20" fill="#2563eb" />
            <circle cx="15" cy="10" r="6" fill="none" stroke="#ffffff" strokeWidth="1.2" />
            <line x1="9" y1="10" x2="21" y2="10" stroke="#ffffff" strokeWidth="1.2" />
            <ellipse cx="15" cy="10" rx="3.5" ry="6" fill="none" stroke="#ffffff" strokeWidth="1.2" />
          </svg>
        );
    }
  };

  return (
    <span
      className={`inline-flex items-center justify-center align-middle border border-black/10 dark:border-white/10 ${className}`}
      title={title || code.toUpperCase()}
      role="img"
      aria-label={title || code.toUpperCase()}
    >
      {renderSvg()}
    </span>
  );
};
