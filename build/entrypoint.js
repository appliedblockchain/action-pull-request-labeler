"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const actions_toolkit_1 = require("actions-toolkit");
const utils_1 = require("./utils");
const args = {
    event: ['pull_request.opened', 'pull_request.synchronize'],
    secrets: ['GITHUB_TOKEN']
};
// Returns the repository information using provided gitHubEventPath
const findRepositoryInformation = (gitHubEventPath, log, exit) => {
    const payload = require(gitHubEventPath);
    if (payload.number === undefined) {
        exit.neutral('Action not triggered by a PullRequest action. PR ID is missing');
    }
    log.info(`Checking files list for PR#${payload.number}`);
    return {
        issue_number: payload.number,
        owner: payload.repository.owner.login,
        repo: payload.repository.name
    };
};
// Find configured filters from the issue labels
const findIssueLabels = (issuesListLabelsOnIssueParams, issues, filters) => {
    // Find issue labels that are configured in .github/label-pr.yml
    return issues.listLabelsOnIssue(issuesListLabelsOnIssueParams)
        .then(({ data: labels }) => labels.reduce((acc, label) => acc.concat(label.name), []))
        .then(issueLabels => utils_1.filterConfiguredIssueLabels(issueLabels, filters));
};
// Remove provided labels
const removeIssueLabels = (labels, { log, exit }, repository, issues) => {
    log.info('Labels to remove: ', labels);
    utils_1.buildIssueRemoveLabelParams(repository, labels)
        .forEach(value => issues.removeLabel(value).catch(reason => exit.failure(reason)));
};
// Build labels to add
const getLabelsToAdd = (labels, issueLabels, { log, exit }) => {
    const labelsToAdd = utils_1.intersectLabels(labels, issueLabels);
    log.info('Labels to add: ', labelsToAdd);
    if (labelsToAdd.length === 0) {
        exit.success("No labels to add");
    }
    return labelsToAdd;
};
// Fetch all files (by recursively calling with page and per_page parameters)
const fetchAllFiles = (listFiles, log, params, per_page, page) => {
    log.info(`Listing files (page: ${page} | per_page: ${per_page})...`);
    return listFiles(Object.assign({ per_page, page }, params))
        .then((response) => {
        // If there may be other files to fetch
        log.info(`Loaded ${response.data.length} files`);
        let pullsListFilesResponseItems = response.data;
        if (pullsListFilesResponseItems.length >= per_page) {
            return fetchAllFiles(listFiles, log, params, per_page, page + 1).then(value => value.concat(pullsListFilesResponseItems));
        }
        return pullsListFilesResponseItems;
    });
};
actions_toolkit_1.Toolkit.run(async (toolkit) => {
    toolkit.log.info('Running Action');
    const configPath = process.env.CONFIG_PATH ? process.env.CONFIG_PATH : '.github/label-pr.yml';
    const filters = toolkit.config(configPath);
    toolkit.log.info(" Configured filters: ", filters);
    if (!process.env.GITHUB_EVENT_PATH) {
        toolkit.exit.failure('Process env GITHUB_EVENT_PATH is undefined');
    }
    else {
        const { owner, issue_number, repo } = findRepositoryInformation(process.env.GITHUB_EVENT_PATH, toolkit.log, toolkit.exit);
        const { pulls: { listFiles }, issues } = toolkit.github;
        // First, we need to retrieve the existing issue labels and filter them over the configured one in config file
        const issueLabels = await findIssueLabels({ issue_number, owner, repo }, issues, filters);
        const params = { owner, pull_number: issue_number, repo };
        await fetchAllFiles(listFiles, toolkit.log, params, 100, 1)
            .then((files) => {
            toolkit.log.info('Checking files...', files.reduce((acc, file) => acc.concat(file.filename), []));
            return files;
        })
            .then((files) => utils_1.processListFilesResponses(files, filters))
            .then((eligibleFilters) => eligibleFilters.reduce((acc, eligibleFilter) => acc.concat(eligibleFilter.labels), []))
            .then((labels) => {
            removeIssueLabels(utils_1.intersectLabels(issueLabels, labels), toolkit, { owner, issue_number, repo }, issues);
            return { issue_number, labels: getLabelsToAdd(labels, issueLabels, toolkit), owner, repo };
        })
            .then((addLabelsParams) => issues.addLabels(addLabelsParams))
            .catch(reason => toolkit.exit.failure(reason))
            .then((value) => toolkit.log.info(`Adding label status: ${value.status}`));
    }
    toolkit.exit.success('Labels were update into pull request');
}, args);
//# sourceMappingURL=entrypoint.js.map