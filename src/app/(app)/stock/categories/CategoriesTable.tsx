'use client';

import { useState } from 'react';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { CategoryDialog } from './CategoryDialog';
import { Plus, Edit2, Layers } from 'lucide-react';

interface CategoryItem {
  id: string;
  name: string;
  code: string;
  description: string | null;
  parentId: string | null;
  isActive: boolean;
  parent?: { name: string; code: string } | null;
}

interface Props {
  categories: CategoryItem[];
}

export function CategoriesTable({ categories }: Props) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState<CategoryItem | null>(null);

  const handleCreate = () => {
    setSelectedCategory(null);
    setDialogOpen(true);
  };

  const handleEdit = (cat: CategoryItem) => {
    setSelectedCategory(cat);
    setDialogOpen(true);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-ace-navy">Product Categories</h1>
          <p className="text-sm text-ace-muted">
            Hierarchical classification for inventory items, reporting, and POS navigation.
          </p>
        </div>
        <Button onClick={handleCreate} id="new-category-btn">
          <Plus className="mr-2 h-4 w-4" />
          New Category
        </Button>
      </div>

      <div className="rounded-lg border bg-white shadow-sm">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Code</TableHead>
              <TableHead>Category Name</TableHead>
              <TableHead>Parent Category</TableHead>
              <TableHead>Description</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Action</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {categories.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="h-24 text-center text-ace-muted">
                  <div className="flex flex-col items-center justify-center gap-1">
                    <Layers className="h-6 w-6 text-gray-400" />
                    <p>No categories created yet.</p>
                  </div>
                </TableCell>
              </TableRow>
            ) : (
              categories.map((cat) => (
                <TableRow key={cat.id}>
                  <TableCell className="font-mono text-sm font-semibold text-ace-navy">
                    {cat.code}
                  </TableCell>
                  <TableCell className="font-medium text-ace-navy">
                    {cat.name}
                  </TableCell>
                  <TableCell className="text-sm text-ace-muted">
                    {cat.parent ? `${cat.parent.name} (${cat.parent.code})` : '—'}
                  </TableCell>
                  <TableCell className="text-sm text-gray-500">
                    {cat.description || '—'}
                  </TableCell>
                  <TableCell>
                    <Badge variant={cat.isActive ? 'default' : 'secondary'} className="text-xs">
                      {cat.isActive ? 'Active' : 'Inactive'}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <Button variant="ghost" size="sm" onClick={() => handleEdit(cat)}>
                      <Edit2 className="h-4 w-4 mr-1" />
                      Edit
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <CategoryDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        category={selectedCategory}
        allCategories={categories}
      />
    </div>
  );
}
