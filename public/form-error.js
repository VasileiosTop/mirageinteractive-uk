(function () {
  var params = new URLSearchParams(location.search);
  var error = params.get('error');
  if (!error) return;
  var messages = {
    invalid: 'That email address looks invalid. Please check and try again.',
    ratelimit: "You've submitted a few times in quick succession. Please wait a minute and try again.",
    turnstile: "Couldn't verify the request. Please try again.",
    server: 'Something went wrong on our end. Please try again in a moment.'
  };
  var msg = messages[error] || 'Something went wrong. Please try again.';
  var slot = document.getElementById('form-error');
  if (slot) {
    slot.textContent = msg;
    slot.removeAttribute('hidden');
  }
  // Strip the ?error= param so the message doesn't persist on refresh.
  if (history.replaceState) {
    history.replaceState({}, '', location.pathname + location.hash);
  }
})();
