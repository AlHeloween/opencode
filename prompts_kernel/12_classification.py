"""Kernel fragment: 12_classification (former monofile L1029-1068)."""


def classify_activity(text: str) -> Activity:
    """Determine Activity from user request text. Keyword-based."""
    t = text.lower()
    if any(w in t for w in ["fix", "change", "configure", "install", "delete",
                             "move", "rename", "publish", "send", "deploy",
                             "create", "write", "edit", "update", "remove",
                             "add", "set up", "modify"]):
        return Activity.MODIFY
    if any(w in t for w in ["run test", "run pytest", "run unit",
                             "build", "lint", "typecheck",
                             "benchmark", "execute test", "compile"]):
        return Activity.EXECUTE_TEST
    if any(w in t for w in ["inspect", "check", "show", "list", "read",
                             "diagnose", "measure", "verify",
                             "how many", "find", "search",
                             "look at", "examine", "review"]):
        return Activity.OBSERVE
    
    # Conversational patterns — default, not OBSERVE
    return Activity.CONVERSATION


def classify_risk(activity: Activity, text: str) -> Risk:
    """Determine risk level from activity and request content."""
    t = text.lower()
    if any(w in t for w in ["delete", "remove", "force", "reset", "drop",
                             "format", "destroy", "unpublish", "revoke", "irreversible"]):
        return Risk.DESTRUCTIVE
    if any(w in t for w in ["permission", "credential", "password", "secret",
                             "token", "api key", "deploy", "publish",
                             "production", "database", "network", "external",
                             "privilege", "ownership", "chmod", "chown",
                             "admin", "sudo", "root", "registry", "package"]):
        return Risk.ELEVATED
    if activity in (Activity.OBSERVE, Activity.CONVERSATION):
        return Risk.LOW
    return Risk.LOW


