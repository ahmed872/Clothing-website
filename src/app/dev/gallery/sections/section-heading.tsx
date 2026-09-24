export function SectionHeading({
  id,
  title,
  description,
}: {
  id: string;
  title: string;
  description?: string;
}) {
  return (
    <div id={id} className="scroll-mt-24 flex flex-col gap-1 border-b border-(--color-border) pb-3">
      <h2 className="text-h4 text-(--color-text)">{title}</h2>
      {description ? <p className="text-small text-(--color-text-muted)">{description}</p> : null}
    </div>
  );
}

export function SubHeading({ children }: { children: React.ReactNode }) {
  return <h3 className="text-label text-(--color-text-muted) uppercase">{children}</h3>;
}
