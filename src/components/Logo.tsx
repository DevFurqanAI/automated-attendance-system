import Image from 'next/image';

/** The branding mark, used on the login screen and in the app header. */
export function Logo({
  size = 32,
  withWordmark = true,
  className = '',
}: {
  size?: number;
  withWordmark?: boolean;
  className?: string;
}) {
  return (
    <span className={`inline-flex items-center gap-2.5 ${className}`}>
      <Image
        src="/icons/icon-192.png"
        alt=""
        width={size}
        height={size}
        priority
        style={{ width: size, height: size }}
      />
      {withWordmark && (
        <span className="text-base font-bold tracking-tight text-brand-secondary">
          Staff Attendance
        </span>
      )}
    </span>
  );
}
