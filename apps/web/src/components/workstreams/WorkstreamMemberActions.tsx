import { ArrowDownIcon, ArrowUpIcon, MoreHorizontalIcon } from "lucide-react";

import { Button } from "../ui/button";
import { Menu, MenuItem, MenuPopup, MenuSeparator, MenuTrigger } from "../ui/menu";
import type { WorkstreamMemberPresentation, WorkstreamMembershipCommand } from "./types";
import {
  getWorkstreamMemberActions,
  planWorkstreamKeyboardMove,
  type WorkstreamMemberAction,
} from "./workstreamPresentation";

export interface WorkstreamMemberActionsProps {
  readonly workstreamId: string;
  readonly member: WorkstreamMemberPresentation;
  readonly position: number;
  readonly memberCount: number;
  readonly onCommand: (command: WorkstreamMembershipCommand) => void;
  readonly onChooseTarget: (action: Extract<WorkstreamMemberAction, "move" | "link">) => void;
}

export function WorkstreamMemberActions(props: WorkstreamMemberActionsProps) {
  const moveByKeyboard = (direction: "up" | "down") => {
    const command = planWorkstreamKeyboardMove({
      workstreamId: props.workstreamId,
      memberRef: props.member.ref,
      currentPosition: props.position,
      direction,
      memberCount: props.memberCount,
    });
    if (command) props.onCommand(command);
  };
  const runAction = (action: WorkstreamMemberAction) => {
    if (action === "move" || action === "link") {
      props.onChooseTarget(action);
      return;
    }
    props.onCommand(
      action === "remove"
        ? {
            type: "remove",
            memberRef: props.member.ref,
            workstreamId: props.workstreamId,
          }
        : {
            type: "reattach",
            memberRef: props.member.ref,
            workstreamId: props.workstreamId,
            association: props.member.association,
          },
    );
  };
  const moveUpDisabled = props.position === 0 || props.member.removedAt !== undefined;
  const moveDownDisabled =
    props.position >= props.memberCount - 1 || props.member.removedAt !== undefined;

  return (
    <div className="flex shrink-0 items-center" data-workstream-member-actions>
      <Button
        aria-label={`Move ${props.member.title} up`}
        disabled={moveUpDisabled}
        onClick={() => moveByKeyboard("up")}
        size="icon-micro"
        variant="ghost-muted"
      >
        <ArrowUpIcon />
      </Button>
      <Button
        aria-label={`Move ${props.member.title} down`}
        disabled={moveDownDisabled}
        onClick={() => moveByKeyboard("down")}
        size="icon-micro"
        variant="ghost-muted"
      >
        <ArrowDownIcon />
      </Button>
      <Menu>
        <MenuTrigger
          aria-label={`Actions for ${props.member.title}`}
          render={<Button size="icon-micro" variant="ghost-muted" />}
        >
          <MoreHorizontalIcon />
        </MenuTrigger>
        <MenuPopup align="end">
          {!props.member.removedAt && (
            <>
              <MenuItem disabled={moveUpDisabled} onClick={() => moveByKeyboard("up")}>
                Move up
              </MenuItem>
              <MenuItem disabled={moveDownDisabled} onClick={() => moveByKeyboard("down")}>
                Move down
              </MenuItem>
              <MenuSeparator />
            </>
          )}
          {getWorkstreamMemberActions({
            association: props.member.association,
            isRemoved: props.member.removedAt !== undefined,
          }).map((action) => (
            <MenuItem
              key={action.id}
              onClick={() => runAction(action.id)}
              variant={action.destructive ? "destructive" : "default"}
            >
              {action.label}
            </MenuItem>
          ))}
        </MenuPopup>
      </Menu>
    </div>
  );
}
