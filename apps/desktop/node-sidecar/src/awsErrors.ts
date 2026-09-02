/** Small helpers for reading AWS SDK errors structurally (never by string-building). */

export function errorName(err: unknown): string {
  const e = err as { name?: string; Code?: string };
  return e?.name ?? e?.Code ?? "";
}

export function errorMessage(err: unknown): string {
  const e = err as { message?: string };
  return e?.message ?? String(err);
}

/** Security Hub answers DescribeHub with InvalidAccessException when not subscribed. */
export function isNotSubscribed(err: unknown): boolean {
  return errorName(err) === "InvalidAccessException";
}

export function isNotFound(err: unknown): boolean {
  const name = errorName(err);
  return (
    name === "ResourceNotFoundException" ||
    name === "NoSuchEntityException" ||
    name === "NoSuchConfigurationRecorderException" ||
    name === "NoSuchDeliveryChannelException" ||
    name === "NoSuchBucket" ||
    name === "NotFoundException" ||
    name === "ValidationError" // CloudFormation's "Stack ... does not exist"
  );
}

/** CreateServiceLinkedRole when the role already exists. */
export function isAlreadyExists(err: unknown): boolean {
  const name = errorName(err);
  return name === "InvalidInputException" || name === "EntityAlreadyExistsException" || name === "ResourceConflictException";
}
