expect-ssh
==========

expect-ssh is an [expect](http://expect.sourceforge.net/) script that wraps ssh to accomplish consistent bash shell
settings when ssh-ing to remote servers. If you have ever spent lots of time setting up your shell
with the perfect settings for .bashrc, .bash_profile, .vimrc, etc., and then
found yourself mass-copying these files to other machines you ssh to, then having to
deal with changing any of your preferences and now having to manually propagate
those changes out to those ssh sites, then this script presents a solution to
avoid those types of headaches.

# Requirements

* Support for running on Linux and Mac OS X (though mostly built/tested on just Linux)
* Assumes you use bash as your main shell
* Depends on some basic standard Unix programs like gzip, grep, cut
* Also must have openssl installed

# How it works

**Step 1: identify your profile.** Start by creating a **profile** (see below), or using an existing profile. My personal profile is the only one so far, called `profile.lenio`.

**Step 2: set up your rcfile.** The rcfile is `$HOME/.expect-ssh/config`. This is sourced by expect-ssh at init time. It may contain any valid expect commands, but in particular you should make a unique password for yourself like so:

    set MYBASHPREFS_PASSWORD 2sCuk5iVuRXrGmmUjLfwFj8fZSsoldML

**Step 3: ssh to a remote system.** Run the following to start a new ssh session:

    expect-ssh myserver.example.com
    
Once ssh drops you into the shell, expect-ssh will detect that and will then proceed to upload only the essential elements of your profile. Why not upload the entire profile? To save time from having to wait, expect-ssh will only upload the minimally necessary files it needs at the time.The profile will load up with its settings and cache them into one or more files under `/tmp/.expect-ssh-x.x`. Each cached file is AES256 encrypted so that no one can read your code. Why cache? This becomes really useful when you start ssh-ing to other systems. More on that below.

Initially, all of your custom bash functions are created as stubs: calling one of them will cause expect-ssh to run commands in your shell to generate the real bash function

# Profiles

A profile is simply a subdirectory off of the git checkout containing a set of bash command files and expect files to fine-tune your bash shell. The subdirectory naming convention is `profile.ID`, where `ID` is some identifier to indicate who the profile was created for, or what it tries to achieve. Files in the profile:

* *.exp: expect commands that get sourced when expect-ssh starts up, these are usually for registering new markers and handlers (see below)
* you should have at least one .exp file that defines your PS1 marker as variable `EXPECTSSH_PS1_MARKER`
* any filename matching `^\w+` is assumed to be bash commands that usually, but not necessarily, define a bash function of the same name. A stub shell function of the same name is the file is created when the bash shell starts. When the user runs one, that file is uploaded, cached to `EXPECTSSH_TMPDIR` in an encrypted format, and sourced.  A new shell will always first try to re-use the cached file, if it does not exist or the md5 checksum fails it will get re-uploaded to the cache.
* .bashrc: put your personal settings here

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
* _ES_esc_ps1
* EXPECTSSH_LOADED_FUNCS: a space separated list of functions that have been loaded into the current shell
* EXPECTSSH_SHLVL: similar to bash's SHLVL

If a bash command file has a dependency on another command file to be loaded
first, add a comment line like this in the file with the dependency:

    # depends:some_other_bash_command_file

Expect files can use the following helper functions:
* _ES_register_marker

Handlers should not have a return value, else the procedure that invokes the
handler will flag it as an error.
