const LOGIN_STARTUP_DELAY_MS = Object.freeze({
    friend: 10000,
    task: 15000,
    sell: 20000,
    sellDebug: 30000,
});

function buildLoginStartupPlan(account = {}) {
    const plan = [];
    if (account.farmEnabled) {
        plan.push({ key: 'farm', delayMs: 0 });
    }
    if (account.friendEnabled) {
        plan.push({ key: 'friend', delayMs: LOGIN_STARTUP_DELAY_MS.friend });
    }
    if (account.taskEnabled) {
        plan.push({ key: 'task', delayMs: LOGIN_STARTUP_DELAY_MS.task });
    }
    if (account.sellEnabled) {
        plan.push({ key: 'sell', delayMs: LOGIN_STARTUP_DELAY_MS.sell });
        plan.push({ key: 'sellDebug', delayMs: LOGIN_STARTUP_DELAY_MS.sellDebug });
    }
    return plan;
}

module.exports = {
    LOGIN_STARTUP_DELAY_MS,
    buildLoginStartupPlan,
};
