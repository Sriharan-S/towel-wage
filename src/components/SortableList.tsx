import { type ReactNode } from "react";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  restrictToParentElement,
  restrictToVerticalAxis,
} from "@dnd-kit/modifiers";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { ArrowDown, ArrowUp, GripVertical } from "lucide-react";
import { IconButton, cx } from "@/components/ui";

/**
 * A list you can put back in the order you want it.
 *
 * Three ways to move a row, because the same list is used on a phone in a mill
 * and on a desktop:
 *
 *  - drag the handle (mouse, or press-and-hold on touch — the delay is there so
 *    a scroll gesture that starts on a handle still scrolls);
 *  - the up/down buttons, which are the only thing that works reliably with wet
 *    or gloved hands;
 *  - the keyboard: focus a handle, then space and the arrow keys.
 *
 * The list is controlled: it reports the new order and draws whatever order it
 * is given back, so the caller decides when a move is saved.
 */

export interface SortableListProps<T> {
  items: T[];
  getId: (item: T) => number;
  onReorder: (ids: number[]) => void;
  children: (item: T, index: number) => ReactNode;
  disabled?: boolean;
}

export function SortableList<T>({
  items,
  getId,
  onReorder,
  children,
  disabled,
}: SortableListProps<T>) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    // Hold before a drag begins, so scrolling the page still scrolls the page.
    useSensor(TouchSensor, { activationConstraint: { delay: 180, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const ids = items.map(getId);

  const move = (from: number, to: number) => {
    if (to < 0 || to >= ids.length || from === to) return;
    onReorder(arrayMove(ids, from, to));
  };

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    move(ids.indexOf(Number(active.id)), ids.indexOf(Number(over.id)));
  };

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={onDragEnd}
      modifiers={[restrictToVerticalAxis, restrictToParentElement]}
    >
      <SortableContext items={ids} strategy={verticalListSortingStrategy}>
        <div className="space-y-2">
          {items.map((item, index) => (
            <SortableRow
              key={getId(item)}
              id={getId(item)}
              index={index}
              count={items.length}
              disabled={disabled}
              onMove={move}
            >
              {children(item, index)}
            </SortableRow>
          ))}
        </div>
      </SortableContext>
    </DndContext>
  );
}

function SortableRow({
  id,
  index,
  count,
  disabled,
  onMove,
  children,
}: {
  id: number;
  index: number;
  count: number;
  disabled?: boolean;
  onMove: (from: number, to: number) => void;
  children: ReactNode;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id, disabled });

  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Translate.toString(transform),
        transition,
        zIndex: isDragging ? 10 : undefined,
        background: "var(--panel)",
        borderColor: isDragging ? "var(--accent, var(--line))" : "var(--line)",
      }}
      className={cx(
        "flex touch-none items-center gap-2 rounded-xl border p-2 pr-1",
        isDragging && "shadow-lg",
      )}
    >
      <button
        ref={setActivatorNodeRef}
        {...attributes}
        {...listeners}
        aria-label={`Move — currently ${index + 1} of ${count}`}
        className="shrink-0 cursor-grab rounded-lg p-2 ink-3 active:cursor-grabbing"
      >
        <GripVertical size={18} />
      </button>

      <div className="min-w-0 flex-1">{children}</div>

      <div className="flex shrink-0 flex-col">
        <IconButton
          label="Move up"
          disabled={index === 0}
          onClick={() => onMove(index, index - 1)}
        >
          <ArrowUp size={15} />
        </IconButton>
        <IconButton
          label="Move down"
          disabled={index === count - 1}
          onClick={() => onMove(index, index + 1)}
        >
          <ArrowDown size={15} />
        </IconButton>
      </div>
    </div>
  );
}
