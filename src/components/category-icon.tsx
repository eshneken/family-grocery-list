import { categoryIcons } from "@/features/catalog/categories";

export function CategoryIcon({ category }: { category: string }) {
  const Icon = categoryIcons[category as keyof typeof categoryIcons] ?? categoryIcons.Other;
  return (
    <span className="category-icon" aria-hidden="true">
      <Icon size={18} strokeWidth={2.2} />
    </span>
  );
}
