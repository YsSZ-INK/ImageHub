export function Progress({ value }: { value: number }) {
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-foreground/[0.08]">
      <div className="h-full rounded-full bg-foreground/60 transition-all duration-500" style={{ width: `${value}%` }} />
    </div>
  );
}
