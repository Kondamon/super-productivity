import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  forwardRef,
  inject,
  input,
  OnDestroy,
  viewChild,
} from '@angular/core';
import { DropListModelSource, Task, TaskWithSubTasks } from '../task.model';
import { TaskService } from '../task.service';
import { expandFadeFastAnimation } from '../../../ui/animations/expand.ani';
import { filterDoneTasks } from '../filter-done-tasks.pipe';
import { T } from '../../../t.const';
import { toSignal } from '@angular/core/rxjs-interop';
import { CdkDropList } from '@angular/cdk/drag-drop';
import { WorkContextType } from '../../work-context/work-context.model';
import { moveTaskInTodayList } from '../../work-context/store/work-context-meta.actions';
import { moveProjectTaskInBacklogList } from '../../project/store/project.actions';
import { moveSubTask } from '../store/task.actions';
import { TaskSharedActions } from '../../../root-store/meta/task-shared.actions';
import { WorkContextService } from '../../work-context/work-context.service';
import { Store } from '@ngrx/store';
import { DropListService } from '../../../core-ui/drop-list/drop-list.service';
import {
  CanDropPredicate,
  MoveInstruction,
  TreeNode,
} from '../../../ui/tree-dnd/tree.types';
import { IssueService } from '../../issue/issue.service';
import { SearchResultItem } from '../../issue/issue.model';
import { MatButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { TaskComponent } from '../task/task.component';
import { ScheduleExternalDragService } from '../../schedule/schedule-week/schedule-external-drag.service';
import { getAfterTaskIdFromInstruction, tasksToTreeNodes } from './task-list-tree.util';
import { TreeDndComponent } from '../../../ui/tree-dnd/tree.component';

export type TaskListId = 'PARENT' | 'SUB';
export type ListModelId = DropListModelSource | string;

const findNodeInTree = <TData>(
  nodes: TreeNode<TData>[],
  nodeId: string,
): TreeNode<TData> | null => {
  for (const node of nodes) {
    if (node.id === nodeId) return node;
    if (node.children) {
      const found = findNodeInTree(node.children, nodeId);
      if (found) return found;
    }
  }
  return null;
};

const findParentNode = <TData>(
  nodes: TreeNode<TData>[],
  childId: string,
): TreeNode<TData> | null => {
  for (const node of nodes) {
    if (node.children?.some((child) => child.id === childId)) {
      return node;
    }
    if (node.children) {
      const found = findParentNode(node.children, childId);
      if (found) return found;
    }
  }
  return null;
};

const getSiblingIds = <TData>(
  nodes: TreeNode<TData>[],
  targetId: string,
  where: string,
): string[] => {
  if (where === 'inside') {
    const targetNode = findNodeInTree(nodes, targetId);
    return targetNode?.children?.map((child) => child.id) ?? [];
  }
  const parentNode = findParentNode(nodes, targetId);
  if (parentNode) {
    return parentNode.children?.map((child) => child.id) ?? [];
  }
  return nodes.map((node) => node.id);
};

@Component({
  selector: 'task-list',
  templateUrl: './task-list.component.html',
  styleUrls: ['./task-list.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  animations: [expandFadeFastAnimation],
  imports: [MatButton, MatIcon, TreeDndComponent, forwardRef(() => TaskComponent)],
})
export class TaskListComponent implements OnDestroy {
  private _taskService = inject(TaskService);
  private _workContextService = inject(WorkContextService);
  private _store = inject(Store);
  private _issueService = inject(IssueService);
  private _scheduleExternalDragService = inject(ScheduleExternalDragService);
  dropListService = inject(DropListService);

  tasks = input<TaskWithSubTasks[]>([]);
  isHideDone = input(false);
  isHideAll = input(false);
  isSortingDisabled = input(false);

  listId = input.required<TaskListId>();
  listModelId = input.required<ListModelId>();
  parentId = input<string | undefined>(undefined);

  noTasksMsg = input<string | undefined>(undefined);
  isBacklog = input(false);
  isSubTaskList = input(false);

  readonly canDropTask: CanDropPredicate<TaskWithSubTasks> = ({ drag, drop, where }) => {
    if (where !== 'inside') return true;
    if (!drop) return true;

    const dragTask = drag.data;

    // Rule 1: Parent with subtasks cannot be nested inside another task
    if (dragTask && dragTask.subTasks?.length) return false;

    // Rule 2: Cannot drop inside a subtask (would create sub-sub-tasks)
    // Subtasks are leaf nodes with no children array
    if (drop.children === undefined) return false;

    return true;
  };

  currentTaskId = toSignal(this._taskService.currentTaskId$);

  filteredTasks = computed<TaskWithSubTasks[]>(() => {
    const tasks = this.tasks();
    if (this.listId() === 'PARENT') {
      return tasks;
    }
    const isHideDone = this.isHideDone();
    const isHideAll = this.isHideAll();
    const currentId = this.currentTaskId() || null;
    return filterDoneTasks(tasks, currentId, isHideDone, isHideAll);
  });

  readonly treeNodes = computed<TreeNode<TaskWithSubTasks>[]>(() => {
    const tasks = this.filteredTasks();
    const currentId = this.currentTaskId() || null;
    return tasksToTreeNodes(tasks, currentId);
  });

  readonly dropListRegistrationConfig = {
    register: (list: CdkDropList, isSub: boolean): void =>
      this.dropListService.registerDropList(list, isSub),
    unregister: (list: CdkDropList): void =>
      this.dropListService.unregisterDropList(list),
    connectedTo: this.dropListService.dropLists,
  };

  doneTasksLength = computed(() => {
    return this.tasks()?.filter((task) => task.isDone).length ?? 0;
  });
  allTasksLength = computed(() => this.tasks()?.length ?? 0);

  readonly treeDnd = viewChild(TreeDndComponent);

  T: typeof T = T;

  constructor() {
    this._setupDragSyncEffect();
  }

  ngOnDestroy(): void {
    this._scheduleExternalDragService.setActiveTask(null);
  }

  trackByFn(index: number, task: Task): string {
    return task.id;
  }

  async _addFromIssuePanel(
    item: SearchResultItem,
    issueProviderId: string,
  ): Promise<void> {
    if (!item.issueType || !item.issueData || !issueProviderId) {
      throw new Error('No issueData');
    }

    await this._issueService.addTaskFromIssue({
      issueDataReduced: item.issueData,
      issueProviderId: issueProviderId,
      issueProviderKey: item.issueType,
    });
  }

  expandDoneTasks(): void {
    const pid = this.parentId();
    if (!pid) {
      throw new Error('Parent ID is undefined');
    }

    this._taskService.showSubTasks(pid);
    // note this might be executed from the task detail panel, where this is not possible
    this._taskService.focusTaskIfPossible(pid);
  }

  onTreeMoved(
    instruction: MoveInstruction,
    treeNodes: TreeNode<TaskWithSubTasks>[],
  ): void {
    if (this._scheduleExternalDragService.isCancelNextDrop()) {
      this._scheduleExternalDragService.setCancelNextDrop(false);
      return;
    }

    const dragNode = findNodeInTree(treeNodes, instruction.itemId);
    if (!dragNode?.data) return;

    const dragTask = dragNode.data;
    const isSubtask = !!dragTask.parentId;
    const siblingIds = getSiblingIds(
      treeNodes,
      instruction.targetId as string,
      instruction.where,
    );

    if (isSubtask) {
      this._handleSubtaskMoved(instruction, treeNodes, dragTask, siblingIds);
    } else {
      this._handleRootTaskMoved(instruction, treeNodes, dragTask, siblingIds);
    }
  }

  private _handleSubtaskMoved(
    instruction: MoveInstruction,
    treeNodes: TreeNode<TaskWithSubTasks>[],
    dragTask: TaskWithSubTasks,
    siblingIds: string[],
  ): void {
    const targetParentId = this._resolveTargetParentId(instruction, treeNodes);
    const afterTaskId = getAfterTaskIdFromInstruction(instruction, siblingIds);

    if (targetParentId) {
      this._dispatchMoveSubTask(dragTask, targetParentId, afterTaskId);
      if (instruction.where === 'inside') {
        this._autoExpandParent(targetParentId, treeNodes);
      }
    } else {
      this._promoteToMainTask(dragTask, instruction, treeNodes, siblingIds);
    }
  }

  private _handleRootTaskMoved(
    instruction: MoveInstruction,
    treeNodes: TreeNode<TaskWithSubTasks>[],
    dragTask: TaskWithSubTasks,
    siblingIds: string[],
  ): void {
    const afterTaskId = getAfterTaskIdFromInstruction(instruction, siblingIds);

    if (instruction.where === 'inside') {
      this._dispatchConvertToSubTask(
        dragTask,
        instruction.targetId as string,
        afterTaskId,
      );
      this._autoExpandParent(instruction.targetId as string, treeNodes);
    } else {
      const targetParent = findParentNode(treeNodes, instruction.targetId as string);
      if (targetParent) {
        this._dispatchConvertToSubTask(dragTask, targetParent.id, afterTaskId);
      } else {
        this._dispatchRootReorder(dragTask.id, afterTaskId);
      }
    }
  }

  private _resolveTargetParentId(
    instruction: MoveInstruction,
    treeNodes: TreeNode<TaskWithSubTasks>[],
  ): string | null {
    if (instruction.where === 'inside') {
      return instruction.targetId as string;
    }
    const parentNode = findParentNode(treeNodes, instruction.targetId as string);
    return parentNode?.id ?? null;
  }

  private _dispatchMoveSubTask(
    dragTask: TaskWithSubTasks,
    targetParentId: string,
    afterTaskId: string | null,
  ): void {
    this._store.dispatch(
      moveSubTask({
        taskId: dragTask.id,
        srcTaskId: dragTask.parentId as string,
        targetTaskId: targetParentId,
        afterTaskId,
      }),
    );
  }

  private _promoteToMainTask(
    dragTask: TaskWithSubTasks,
    instruction: MoveInstruction,
    treeNodes: TreeNode<TaskWithSubTasks>[],
    siblingIds: string[],
  ): void {
    const parentNode = findNodeInTree(treeNodes, dragTask.parentId as string);
    const parentTagIds = parentNode?.data?.tagIds ?? [];
    const isPlanForToday = this._workContextService.activeWorkContextId === 'TODAY';

    this._store.dispatch(
      TaskSharedActions.convertToMainTask({
        task: dragTask,
        parentTagIds,
        isPlanForToday,
      }),
    );

    const rootIds = treeNodes.map((node) => node.id);
    const afterTaskId = getAfterTaskIdFromInstruction(instruction, rootIds);
    this._dispatchRootReorder(dragTask.id, afterTaskId);
  }

  private _dispatchConvertToSubTask(
    dragTask: TaskWithSubTasks,
    newParentId: string,
    afterTaskId: string | null,
  ): void {
    this._store.dispatch(
      TaskSharedActions.convertToSubTask({
        task: dragTask,
        newParentId,
        afterTaskId,
      }),
    );
  }

  private _autoExpandParent(
    parentId: string,
    treeNodes: TreeNode<TaskWithSubTasks>[],
  ): void {
    const parentNode = findNodeInTree(treeNodes, parentId);
    if (parentNode?.data?._hideSubTasksMode) {
      this._taskService.showSubTasks(parentId);
    }
  }

  private _dispatchRootReorder(taskId: string, afterTaskId: string | null): void {
    const workContextId = this._workContextService.activeWorkContextId as string;
    const workContextType = this._workContextService
      .activeWorkContextType as WorkContextType;

    if (this.isBacklog()) {
      this._store.dispatch(
        moveProjectTaskInBacklogList({ taskId, afterTaskId, workContextId }),
      );
    } else {
      this._store.dispatch(
        moveTaskInTodayList({
          taskId,
          afterTaskId,
          workContextId,
          workContextType,
          src: 'UNDONE' as DropListModelSource,
          target: 'UNDONE' as DropListModelSource,
        }),
      );
    }
  }

  private _setupDragSyncEffect(): void {
    effect(() => {
      const tree = this.treeDnd();
      if (!tree) return;
      const dragId = tree.draggingId();
      if (dragId) {
        const task = this._findTaskById(dragId);
        if (task) {
          this._scheduleExternalDragService.setActiveTask(task);
        }
      } else {
        this._scheduleExternalDragService.setActiveTask(null);
      }
    });
  }

  private _findTaskById(taskId: string): TaskWithSubTasks | null {
    for (const task of this.tasks()) {
      if (task.id === taskId) return task;
      const subTask = task.subTasks?.find((subT) => subT.id === taskId);
      if (subTask) return subTask as TaskWithSubTasks;
    }
    return null;
  }
}
