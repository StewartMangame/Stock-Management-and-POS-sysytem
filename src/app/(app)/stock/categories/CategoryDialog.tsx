'use client';

import { useState, useTransition, useEffect } from 'react';
import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { createCategoryAction, updateCategoryAction } from './actions';

export interface CategoryItem {
  id: string;
  name: string;
  code: string;
  description: string | null;
  parentId: string | null;
  isActive: boolean;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  category?: CategoryItem | null;
  allCategories?: CategoryItem[];
  onSuccess?: (category: CategoryItem) => void;
}

export function CategoryDialog({ open, onOpenChange, category, allCategories = [], onSuccess }: Props) {
  const [isPending, startTransition] = useTransition();

  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [description, setDescription] = useState('');
  const [parentId, setParentId] = useState<string>('none');
  const [isActive, setIsActive] = useState(true);

  useEffect(() => {
    if (category) {
      setName(category.name);
      setCode(category.code);
      setDescription(category.description ?? '');
      setParentId(category.parentId ?? 'none');
      setIsActive(category.isActive);
    } else {
      setName('');
      setCode('');
      setDescription('');
      setParentId('none');
      setIsActive(true);
    }
  }, [category, open]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    if (!name.trim() || !code.trim()) {
      toast.error('Name and code are required.');
      return;
    }

    startTransition(async () => {
      try {
        const payload = {
          name: name.trim(),
          code: code.trim().toUpperCase(),
          description: description.trim() || undefined,
          parentId: parentId === 'none' ? null : parentId,
          isActive,
        };

        if (category) {
          const res = await updateCategoryAction(category.id, payload);
          toast.success('Category updated successfully');
          if (res?.cat && onSuccess) {
            onSuccess(res.cat as CategoryItem);
          }
        } else {
          const res = await createCategoryAction(payload);
          toast.success('Category created successfully');
          if (res?.cat && onSuccess) {
            onSuccess(res.cat as CategoryItem);
          }
        }
        onOpenChange(false);
      } catch (err: any) {
        toast.error(err.message || 'Operation failed');
      }
    });
  };

  const eligibleParents = allCategories.filter((c) => !category || c.id !== category.id);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{category ? 'Edit Category' : 'New Category'}</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="cat-name">Category Name *</Label>
            <Input
              id="cat-name"
              placeholder="e.g. Laptops & Computers"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                if (!category && !code) {
                  setCode(
                    e.target.value
                      .toUpperCase()
                      .replace(/[^A-Z0-9]/g, '')
                      .slice(0, 8)
                  );
                }
              }}
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="cat-code">Code *</Label>
            <Input
              id="cat-code"
              placeholder="e.g. COMP"
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="cat-parent">Parent Category (Optional)</Label>
            <Select value={parentId} onValueChange={setParentId}>
              <SelectTrigger id="cat-parent">
                <SelectValue placeholder="None (Top Level)" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">None (Top Level)</SelectItem>
                {eligibleParents.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name} ({p.code})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="cat-desc">Description</Label>
            <Input
              id="cat-desc"
              placeholder="Brief description of products in category"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>

          <div className="flex items-center justify-between pt-2">
            <Label htmlFor="cat-active" className="cursor-pointer">
              Active Category
            </Label>
            <Switch
              id="cat-active"
              checked={isActive}
              onCheckedChange={setIsActive}
            />
          </div>

          <DialogFooter className="pt-4">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={isPending}>
              {isPending ? 'Saving...' : category ? 'Update Category' : 'Create Category'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
