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

/**
 * Throttling, across the services this poppy touches. Read structurally — the error NAME, and
 * the HTTP status the SDK attaches — never by matching the human message: IAM says "Rate
 * exceeded", Config says "ThrottlingException", and a message match would break the first time
 * AWS reworded one.
 */
export function isThrottled(err: unknown): boolean {
  const name = errorName(err);
  if (
    name === "ThrottlingException" ||
    name === "Throttling" ||
    name === "TooManyRequestsException" ||
    name === "RequestLimitExceeded" ||
    name === "RequestThrottled" ||
    name === "RequestThrottledException" ||
    name === "SlowDown"
  ) {
    return true;
  }
  const meta = (err as { $metadata?: { httpStatusCode?: number } })?.$metadata;
  return meta?.httpStatusCode === 429;
}

/**
 * Credentials AWS will no longer accept. Distinct from throttling: retrying with the SAME token
 * can never succeed, so the only useful response is to mint a new one.
 *
 * "The security token included in the request is invalid" (InvalidClientTokenId) is what the
 * founder hit on 2026-09-05 after re-approving the connection — re-approval rotates the session
 * underneath a sidecar that is still holding the previous token.
 */
export function isInvalidToken(err: unknown): boolean {
  const name = errorName(err);
  return (
    name === "InvalidClientTokenId" ||
    name === "UnrecognizedClientException" ||
    name === "ExpiredToken" ||
    name === "ExpiredTokenException" ||
    name === "RequestExpired" ||
    name === "InvalidAccessKeyId" ||
    name === "AuthFailure"
  );
}
