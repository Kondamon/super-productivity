import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TaskListComponent } from './task-list.component';
import { provideMockStore } from '@ngrx/store/testing';
import { TaskService } from '../task.service';
import { WorkContextService } from '../../work-context/work-context.service';
import { IssueService } from '../../issue/issue.service';
import { ScheduleExternalDragService } from '../../schedule/schedule-week/schedule-external-drag.service';
import { DropListService } from '../../../core-ui/drop-list/drop-list.service';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { of } from 'rxjs';
import { TaskWithSubTasks } from '../task.model';
import { TreeNode } from '../../../ui/tree-dnd/tree.types';

describe('TaskListComponent', () => {
  let component: TaskListComponent;
  let fixture: ComponentFixture<TaskListComponent>;

  // Helper to create a mock TreeNode for drag/drop context
  const createMockNode = (
    overrides: Partial<TreeNode<TaskWithSubTasks>> & { id: string },
  ): TreeNode<TaskWithSubTasks> => ({
    ...overrides,
  });

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [TaskListComponent, NoopAnimationsModule],
      providers: [
        provideMockStore({ initialState: {} }),
        {
          provide: TaskService,
          useValue: { currentTaskId$: of(null) },
        },
        {
          provide: WorkContextService,
          useValue: {
            activeWorkContextId: 'test-context',
            activeWorkContextType: 'TAG',
          },
        },
        { provide: IssueService, useValue: {} },
        {
          provide: ScheduleExternalDragService,
          useValue: {
            setActiveTask: () => {},
            isCancelNextDrop: () => false,
            setCancelNextDrop: () => {},
          },
        },
        {
          provide: DropListService,
          useValue: {
            registerDropList: () => {},
            unregisterDropList: () => {},
            dropLists: of([]),
            blockAniTrigger$: { next: () => {} },
          },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(TaskListComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('listId', 'PARENT');
    fixture.componentRef.setInput('listModelId', 'UNDONE');
    fixture.detectChanges();
  });

  describe('canDropTask', () => {
    describe('non-inside drops (before/after/root)', () => {
      it('should allow before drops', () => {
        const drag = createMockNode({ id: 'task1', children: [] });
        const drop = createMockNode({ id: 'task2', children: [] });
        expect(component.canDropTask({ drag, drop, where: 'before' })).toBe(true);
      });

      it('should allow after drops', () => {
        const drag = createMockNode({ id: 'task1', children: [] });
        const drop = createMockNode({ id: 'task2', children: [] });
        expect(component.canDropTask({ drag, drop, where: 'after' })).toBe(true);
      });

      it('should allow root drops', () => {
        const drag = createMockNode({ id: 'task1', children: [] });
        expect(component.canDropTask({ drag, drop: null, where: 'root' })).toBe(true);
      });
    });

    describe('inside drops - 2-level hierarchy enforcement', () => {
      it('should allow task without subtasks to drop inside a folder node', () => {
        const drag = createMockNode({
          id: 'task1',
          data: { subTasks: [] } as unknown as TaskWithSubTasks,
          children: [],
        });
        const drop = createMockNode({ id: 'parent1', children: [] });
        expect(component.canDropTask({ drag, drop, where: 'inside' })).toBe(true);
      });

      it('should block task with subtasks from dropping inside another task', () => {
        const drag = createMockNode({
          id: 'task1',
          data: {
            subTasks: [{ id: 'sub1' }],
          } as unknown as TaskWithSubTasks,
          children: [createMockNode({ id: 'sub1' })],
        });
        const drop = createMockNode({ id: 'parent1', children: [] });
        expect(component.canDropTask({ drag, drop, where: 'inside' })).toBe(false);
      });

      it('should block drop inside a leaf node (subtask)', () => {
        const drag = createMockNode({
          id: 'task1',
          data: { subTasks: [] } as unknown as TaskWithSubTasks,
        });
        // Leaf node: children is undefined
        const drop = createMockNode({ id: 'sub1' });
        expect(component.canDropTask({ drag, drop, where: 'inside' })).toBe(false);
      });

      it('should allow drop inside when drop target is null', () => {
        const drag = createMockNode({
          id: 'task1',
          data: { subTasks: [] } as unknown as TaskWithSubTasks,
        });
        expect(component.canDropTask({ drag, drop: null, where: 'inside' })).toBe(true);
      });
    });

    describe('edge cases', () => {
      it('should allow drop inside folder when drag has no data', () => {
        const drag = createMockNode({ id: 'task1' });
        const drop = createMockNode({ id: 'parent1', children: [] });
        expect(component.canDropTask({ drag, drop, where: 'inside' })).toBe(true);
      });

      it('should allow before/after reordering even for tasks with subtasks', () => {
        const drag = createMockNode({
          id: 'task1',
          data: {
            subTasks: [{ id: 'sub1' }],
          } as unknown as TaskWithSubTasks,
          children: [createMockNode({ id: 'sub1' })],
        });
        const drop = createMockNode({ id: 'task2', children: [] });
        expect(component.canDropTask({ drag, drop, where: 'before' })).toBe(true);
        expect(component.canDropTask({ drag, drop, where: 'after' })).toBe(true);
      });
    });
  });
});
