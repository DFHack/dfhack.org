(function() {
	"use strict";

	// from MDN's article on Page Visibility API
	var hiddenProperty, visibilityChangeEvent;
	if (typeof document.hidden !== "undefined") {
		hiddenProperty = "hidden";
		visibilityChangeEvent = "visibilitychange";
	} else if (typeof document.msHidden !== "undefined") {
		hiddenProperty = "msHidden";
		visibilityChangeEvent = "msvisibilitychange";
	} else if (typeof document.webkitHidden !== "undefined") {
		hiddenProperty = "webkitHidden";
		visibilityChangeEvent = "webkitvisibilitychange";
	}

	var reconnectWhenVisible = false;
	var sse;

	var executions = {};
	var baseContainer = document.getElementById("status");

	function Execution(id, title) {
		this.id = id;
		this.title = title;

		this.container = document.createElement("div");
		this.container.classList.add("execution-group");
		var titleEl = document.createElement("h1");
		titleEl.textContent = title;
		this.container.appendChild(titleEl);
		this.statusContainer = document.createElement("div");
		this.statusContainer.classList.add("executions");
		this.container.appendChild(this.statusContainer);
		this.status = {};
		this.logContainer = document.createElement("div");
		this.logContainer.classList.add("log-entries");
		var logContainer2 = document.createElement("div");
		logContainer2.classList.add("log");
		logContainer2.appendChild(this.logContainer);
		this.container.appendChild(logContainer2);
		baseContainer.appendChild(this.container);
	}

	Execution.prototype = {
		destroy: function() {
			baseContainer.removeChild(this.container);
		},
		push_log: function(level, message) {
			var entry = document.createElement("div");
			entry.classList.add("log-entry");
			entry.classList.add("log-entry-" + level);
			entry.textContent = message;
			this.logContainer.appendChild(entry);
		},
		update_status: function(status) {
			var self = this;
			status.forEach(function(e) {
				if (!self.status[e.I]) {
					var el = document.createElement("div");
					el.classList.add("execution");
					el.classList.add("mode-" + e.M);
					el.classList.add("status-" + e.S);
					el.classList.add("runstate-" + e.R);
					self.statusContainer.appendChild(el);
					var title = document.createElement("h2");
					title.textContent = e.T;
					el.appendChild(title);
					self.status[e.I] = document.createElement("div");
					el.appendChild(self.status[e.I]);
				}

				renderOp(self.status[e.I], e.O);
			});
		},
	};

	function renderOp(el, op) {
		if (!op || !op.ShortDescription) {
			el.hidden = true;
			return;
		}
		el.hidden = false;
		el.classList.add("op");
		el.classList.toggle("op-stalled", op.StatementStalled);
		el.innerHTML = op.ShortDescription;
		if (op.LongDescription) {
			var desc = document.createElement("small");
			desc.innerHTML = op.LongDescription;
			el.appendChild(document.createElement("br"));
			el.appendChild(desc);
		}
		if (op.StatementMessage) {
			var msg = document.createElement("span");
			msg.classList.add("stmt-msg");
			msg.textContent = op.StatementMessage;
			el.insertBefore(msg, el.firstChild);
		}
		if (op.AsyncTitle) {
			var atitle = document.createElement("span");
			atitle.classList.add("async");
			atitle.textContent = op.AsyncTitle;
			el.insertBefore(atitle, el.firstChild);
		}
		if (op.PercentComplete !== null) {
			var prog = document.createElement("progress");
			prog.min = 0;
			prog.max = 100;
			prog.value = op.PercentComplete;
			el.appendChild(prog);
		}
		if (op.StatementPercentComplete !== null) {
			var prog = document.createElement("progress");
			prog.min = 0;
			prog.max = 100;
			prog.value = op.StatementPercentComplete;
			el.appendChild(prog);
		}

		var background = (op.BackgroundOperations || []).filter(function(b) {
			return b && b.ShortDescription;
		});
		if (background.length) {
			var list = document.createElement("div");
			list.classList.add("background");
			background.forEach(function(bop) {
				var bel = document.createElement("div");
				renderOp(bel, bop);
				list.appendChild(bel);
			});
			el.appendChild(list);
		}
	}

	function connect() {
		showDisconnectedUI(true);
		reconnectWhenVisible = false;

		if (sse) {
			sse.close();
		}

		sse = new EventSource("https://buildmaster.lubar.me/lubar/events");
		sse.onopen = function() {
			// reset UI when we (re)connect
			hideDisconnectedUI();
			Object.keys(executions).forEach(function(id) {
				executions[id].destroy();
				delete executions[id];
			});
		};
		sse.onmessage = function(e) {
			var data = e.data.split(/\n/g, 3);
			var execution = executions[data[1]];
			switch (data[0]) {
				case "execution_create":
					executions[data[1]] = new Execution(data[1], data[2]);
					break;
				case "execution_destroy":
					if (execution) {
						execution.destroy();
					}
					delete executions[data[1]];
					break;
				case "execution_log":
					if (execution) {
						execution.push_log(data[2].charAt(0), data[2].substr(1));
					}
					break;
				case "execution_update":
					if (execution) {
						execution.update_status(JSON.parse(data[2]));
					}
					break;
			}
		};

		sse.onerror = function() {
			if (sse.readyState === EventSource.CONNECTING) {
				showDisconnectedUI(true);
			} else if (sse.readyState === EventSource.CLOSED) {
				handleConnectionError();
			}
		};
	}

	var disconnectedUI = document.getElementById("disconnected");
	var reconnectingUI = document.getElementById("reconnecting");
	var reconnectButton = document.getElementById("reconnect");
	function showDisconnectedUI(reconnecting) {
		disconnectedUI.style.display = "block";
		if (reconnecting) {
			reconnectingUI.style.display = "inline-block";
			reconnectButton.style.display = "none";
		} else {
			reconnectingUI.style.display = "none";
			reconnectButton.style.display = "inline-block";
		}
	}

	function hideDisconnectedUI() {
		disconnectedUI.style.display = "none";
	}

	reconnectButton.addEventListener("click", function() {
		connect();
	});

	var lastReconnect = Date.now();
	function handleConnectionError() {
		// if the API isn't supported, assume not visible
		var isVisible = hiddenProperty && !document[hiddenProperty];

		// only hard-reconnect automatically once per minute
		var shouldReconnect = Date.now() - lastReconnect > 60000;

		showDisconnectedUI(isVisible && shouldReconnect);
		if (shouldReconnect) {
			lastReconnect = Date.now();

			if (isVisible) {
				showDisconnectedUI(true);
				connect();
				return;
			}

			reconnectWhenVisible = true;
		}

		showDisconnectedUI(false);
	}

	if (hiddenProperty && visibilityChangeEvent) {
		document.addEventListener(visibilityChangeEvent, function() {
			if (!document[hiddenProperty] && reconnectWhenVisible) {
				connect();
			}
		});
	}

	connect();
})();
