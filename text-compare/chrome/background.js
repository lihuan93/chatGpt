// A full tab keeps the comparison readable and does not close when focus moves.
chrome.action.onClicked.addListener(() => {
  chrome.tabs.create({url: chrome.runtime.getURL('index.html')});
});
