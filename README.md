expect-ssh
==========

Format of this file is described [here](https://help.github.com/articles/github-flavored-markdown/).

expect-ssh is a script that wraps ssh to accomplish consistent bash shell
settings when navigating to remote servers. Also provides a copy/paste
interface to make it very easy to copy text from vim running on remote systems,
or just copying stdout or files on remote systems.

# Requirements

* Support for running on Linux and Mac OS X (though mostly built/tested on just Linux)
* Assumes you use bash as your main shell
* Depends on some basic standard Unix programs like gzip, grep, cut
* Must have openssl installed

# Profiles

A profile is a directory containing a set of bash command files and expect
files to fine-tune your bash shell. Files in the profile:

* *.exp: expect commands that get sourced when expect-ssh starts up, these are usually for registering new markers and handlers (see below)
* any filename matching `^\w+` is assumed to be bash commands that usually, but not necessarily, define a bash function of the same name. A stub shell function of the same name is the file is created when the bash shell starts. When the user runs one, that file is uploaded, cached to `EXPECTSSH_TMPDIR` in an encrypted format, and sourced.  A new shell will always first try to re-use the cached file, if it does not exist or the md5 checksum fails it will get re-uploaded to the cache.

## Markers and handlers

Each marker is a small pattern (like `~@12:`) that the main expect loop will
detect and then trigger the marker's handler.

Markers invoke handlers by using the `_ES_send_marker` bash function like so:

    marker=$(_ES_marker MARKER_HUMAN_FRIENDLY_NAME)
    _ES_send_marker "$marker" "any paramaters here ..."

Handlers can utilize the following global variables:
* OS: output from `uname -s`, e.g. `Linux` or `Darwin`
* PROMPT: holds the regex to detect a bash prompt
* EXPECTSSH_TMPDIR: temporary storage directory
* EXPECTSSH_PROFILE: directory of the current profile
* EXPECTSSH_FUNCTIONS_DIR

A handler can expect a single arg to be passed to it.  The format of this data
is up to you to define: it is the 2nd arg shown above with `_ES_send_marker`.

## Other notes

Bash command files can use the following helper functions/environment variables:
* _ES_marker
* EXPECTSSH_LOADED_FUNCS: a space separated list of functions that have been loaded into the current shell

If a bash command file has a dependency on another command file to be loaded
first, add a comment line like this in the file with the dependency:

    # depends:some_other_bash_command_file

Expect files can use the following helper functions:
* _ES_register_marker

Handlers should not have a return value, else the procedure that invokes the
handler will flag it as an error.
