import { type LogoEntry } from "@/data/logos";

type LogoRotatorProps = {
  logos: LogoEntry[];
  speedSeconds?: number;
};

function LogoTile({ entry, ariaHidden = false }: { entry: LogoEntry; ariaHidden?: boolean }) {
  return (
    <div
      className="flex-shrink-0 mx-3 bg-white rounded-md flex items-center justify-center px-6 py-4 w-[180px] md:w-[200px] h-[96px] md:h-[110px]"
      aria-hidden={ariaHidden || undefined}
    >
      <img
        src={entry.src}
        alt={ariaHidden ? "" : `${entry.name} logo`}
        loading="lazy"
        className="max-h-12 md:max-h-14 max-w-full w-auto h-auto object-contain"
      />
    </div>
  );
}

export function LogoRotator({ logos, speedSeconds = 40 }: LogoRotatorProps) {
  if (logos.length === 0) return null;

  return (
    <div
      className="logo-rotator group relative w-full overflow-hidden"
      aria-label="Client and partner logos"
      role="region"
      style={
        {
          ["--logo-rotator-duration" as string]: `${speedSeconds}s`,
          maskImage:
            "linear-gradient(to right, transparent, black 6%, black 94%, transparent)",
          WebkitMaskImage:
            "linear-gradient(to right, transparent, black 6%, black 94%, transparent)",
        } as React.CSSProperties
      }
    >
      <div className="logo-rotator-track flex w-max items-center py-2">
        <div className="flex items-center">
          {logos.map((logo) => (
            <LogoTile key={`a-${logo.name}`} entry={logo} />
          ))}
        </div>
        <div className="flex items-center" aria-hidden="true">
          {logos.map((logo) => (
            <LogoTile key={`b-${logo.name}`} entry={logo} ariaHidden />
          ))}
        </div>
      </div>
    </div>
  );
}
