const form = document.querySelector('form');
const input = document.querySelector('input');
const button = document.querySelector('button');
const cancel = document.querySelector('a');
const errorText = document.querySelector('[role="alert"]');

function showError(error) {
  errorText.hidden = false;
  errorText.textContent = error.message.replace(/^.*?Error invoking remote method.*?Error: /, '');
}

form.inert = true;
window.argivitDesktop.serverOrigin().then((origin) => {
  input.value = origin ?? '';
  cancel.hidden = !origin;
  form.inert = false;
  input.focus();
}).catch(showError);

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  button.disabled = true;
  button.textContent = 'Checking connection…';
  errorText.hidden = true;
  try {
    const changed = await window.argivitDesktop.setServerOrigin(input.value.trim());
    if (changed) {
      localStorage.removeItem('argivit_auth_token');
      localStorage.removeItem('argivit_pos_cashier_v1');
    }
    location.assign('/');
  } catch (error) {
    showError(error);
  } finally {
    button.disabled = false;
    button.textContent = 'Save and connect';
  }
});
